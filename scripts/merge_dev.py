#!/usr/bin/env python3
"""The paved path for merging a workload PR to dev.

One instruction replaces four rules: this script refuses unless every
required CI check succeeded, a fresh-context reviewer pass is posted, the
base is dev, the head is claude/*, and the PR isn't a draft. It is a
paved path, not a wall — nothing stops `gh pr merge` by hand, which is
why merging any other way is declared a defect in CLAUDE.md.

On transport failure it says so and stops: do NOT merge by hand as a
workaround — fix the cause or put it in the needs-Steve digest.

Credentials come from the App via scripts/gh_token.py, scoped to this
repository and to the permissions a merge actually needs. If minting
fails, this script stops at exit 4 without calling `gh` at all — it does
not retry under whatever credential the environment happens to carry,
because a silent fallback is how a broad standing token survives a
migration meant to remove it (governance/grants.md, Grant 4). It cannot
scrub the environment it runs in; what it guarantees is its own conduct.

Exit codes:
    0  merged. A cleanup failure after the merge landed (branch deletion
       runs after the merge commits) is reported loudly but is still 0 —
       done means merged, and the message says what is left to tidy.
    1  refused — the PR is blocked; every blocker is listed.
    2  usage error
    3  transport failure — nothing was merged, and not because the PR
       was blocked.
    4  credential or permission failure — nothing was merged, and not
       because the PR was blocked. Includes an inspect token that could
       not resolve a field the decision needs: an unreadable field is a
       credential problem, never a blocker.
    5  not decided yet — checks are still running. Nothing was merged
       and nothing was refused; re-run once they settle.

Usage: python3 scripts/merge_dev.py <PR-number>
"""

import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys

# The fields the inspect query asks for, and the permission each one
# needs. INSPECT_PERMISSIONS is DERIVED from this map plus
# ROLLUP_PERMISSIONS below — adding a field without a permissions entry
# fails the test suite, because three consecutive PRs (#24, #25, #27)
# each corrected a hand-asserted set that the previous suite had waved
# through (sofa-claude Issue #30).
FIELDS = ("isDraft", "state", "baseRefName", "headRefName", "headRefOid",
          "comments")
FIELD_PERMISSIONS = {
    "isDraft": {"pull_requests": "read"},
    "state": {"pull_requests": "read"},
    "baseRefName": {"pull_requests": "read"},
    "headRefName": {"pull_requests": "read"},
    "headRefOid": {"pull_requests": "read"},  # the commit the rollup reads
    "comments": {"pull_requests": "read"},
}

# The CI-status rollup used to be a field on the query above
# (statusCheckRollup) — but on a private repo it fails outright,
# "Resource not accessible by integration", under the FULL permission
# set below; the same commit's checks and statuses read back cleanly
# over REST under the same permissions (Issue #33, probed 2026-08-21).
# So it is read as two REST calls instead (_fetch_rollup) and reshaped
# into the same CheckRun/StatusContext node list the field used to
# produce — evaluate() and _split_rollup() below are unchanged; only
# how the data arrives is. Resolving each check's workflow run — what
# `actions` was for — turns out not to be needed at all: it was never
# the cause of the private-repo failure, just a permission requested
# alongside it.
ROLLUP_PERMISSIONS = {"checks": "read", "statuses": "read"}

# Whether gh reports the field as null when the token cannot resolve it,
# rather than failing the whole query: true for comments (a
# connection), false for the five scalars that ride on the pull_requests
# read the query itself needs (present whenever the query succeeds at
# all). The rollup is no longer part of this query — a REST permission
# problem surfaces as a thrown error, never a silent null, so main()
# treats a failed rollup fetch as a transport failure like any other
# failed gh call, not as an unresolved field. Every FIELDS entry must be
# classified — the derivation below KeyErrors on an unclassified field,
# for the same reason INSPECT_PERMISSIONS is derived rather than
# hand-asserted (Issue #30).
FIELD_NULL_MEANS_UNRESOLVED = {
    "isDraft": False,
    "state": False,
    "baseRefName": False,
    "headRefName": False,
    "headRefOid": False,
    "comments": True,
}
UNRESOLVED_NULL_FIELDS = tuple(
    f for f in FIELDS if FIELD_NULL_MEANS_UNRESOLVED[f])

# Two phases, deliberately. Reading a PR to decide whether it may merge
# needs nothing writable, so a refused PR never has a merge-capable
# credential in the room at all. The write token is minted only once
# evaluate() has returned no blockers — and it carries ONLY what the
# merge call itself needs: the inspection surface (checks, statuses)
# stays out of the merge token, because the rollup was already
# evaluated under the read token before this one exists (Issue #30).
def _derive_inspect():
    perms = {"metadata": "read"}
    for field in FIELDS:
        perms.update(FIELD_PERMISSIONS[field])
    perms.update(ROLLUP_PERMISSIONS)
    return perms

INSPECT_PERMISSIONS = _derive_inspect()
MERGE_PERMISSIONS = {
    "contents": "write",       # squash-merge, delete branch
    "pull_requests": "write",  # perform the merge
    "metadata": "read",
}


def _gh_token_module():
    path = pathlib.Path(__file__).resolve().parent / "gh_token.py"
    if not path.exists():
        raise RuntimeError(
            f"{path} is missing. It is the only sanctioned credential path; "
            f"bootstrap copies it alongside this script.")
    spec = importlib.util.spec_from_file_location("gh_token", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def repo_slug(remote_url):
    """(owner, repo) from a git remote URL, SSH or HTTPS."""
    match = re.search(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?/?$", remote_url.strip())
    if not match:
        raise RuntimeError(f"Cannot parse an owner/repo out of {remote_url!r}.")
    return match.group(1), match.group(2)


def _origin():
    url = subprocess.run(["git", "remote", "get-url", "origin"],
                         check=True, capture_output=True, text=True).stdout
    return repo_slug(url)

REVIEW_MARKER = "## Reviewer pass"
# Bootstrap aligns these with the workload ci.yml's actual job names.
REQUIRED_CHECKS = ("lint", "test", "secrets")
# Acceptable states for checks that are NOT required (required checks
# must be SUCCESS outright — a skipped required check is not green).
GOOD_CONCLUSIONS = {"SUCCESS", "NEUTRAL", "SKIPPED"}
# States that mean "not decided yet" — neither green nor a failure. A
# still-building deployment preview posts PENDING and resolves minutes
# later; reporting that as *failing* sends an unattended agent to
# investigate a failure that does not exist (Issue #31). The empty
# string is a CheckRun still running: its conclusion is unset.
PENDING_STATES = {"PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS",
                  "WAITING", ""}


def _verdict(raw):
    """Collapse a raw node state to 'good', 'bad', or None while pending.

    CheckRun conclusions and StatusContext states are different enums
    sharing only a few members, so comparing them raw calls NEUTRAL
    versus SUCCESS a conflict; and a node that has not finished holds no
    verdict at all — pending must never be read as one (Issue #31).
    """
    if raw in PENDING_STATES:
        return None
    return "good" if raw in GOOD_CONCLUSIONS else "bad"


def _split_rollup(rollup):
    """Separate CheckRun and StatusContext nodes into their own maps.

    The two shapes share nothing but a rollup: a CheckRun is a workflow
    run, a StatusContext is a bare assertion anything with statuses:write
    can post. Keying them into one dict let a posted status satisfy — or,
    on a name collision, silently override — a required check
    (Issue #28). __typename decides when present; the node shape
    (StatusContext has `context`, CheckRun has `name`) decides otherwise.
    """
    check_runs, contexts = {}, {}
    for node in rollup or []:
        typename = node.get("__typename")
        is_status = (typename == "StatusContext" if typename
                     else "context" in node)
        if is_status:
            name = node.get("context") or node.get("name") or "?"
            contexts[name] = (node.get("state") or "").upper()
        else:
            name = node.get("name") or "?"
            check_runs[name] = (node.get("conclusion")
                                or node.get("status") or "").upper()
    return check_runs, contexts


def evaluate(pr, comment_bodies):
    """Return (blockers, pending).

    Empty blockers and empty pending means the merge may proceed; empty
    blockers with pending entries means nothing is wrong yet and nothing
    is decided yet — retry when the pending checks settle.

    Invariant: no blocker string may contain REVIEW_MARKER, so a refusal
    pasted into a PR comment can never become the passing credential.
    """
    blockers = []
    pending = []
    if pr.get("isDraft"):
        blockers.append("PR is a draft — ready means merging is the only "
                        "step left, and this PR isn't there yet.")
    if pr.get("state") != "OPEN":
        blockers.append(f"PR state is {pr.get('state')!r}, not OPEN.")
    if pr.get("baseRefName") != "dev":
        blockers.append(f"Base branch is {pr.get('baseRefName')!r} — this "
                        "script merges to dev only; staging and main are "
                        "Steve's promotions.")
    if not str(pr.get("headRefName", "")).startswith("claude/"):
        blockers.append(f"Head branch {pr.get('headRefName')!r} is not a "
                        "claude/* branch.")
    check_runs, contexts = _split_rollup(pr.get("statusCheckRollup"))
    # One name carrying two disagreeing verdicts is refused outright —
    # the alternative is the merge decision depending on node order in
    # the rollup, silently (Issue #28). Compared through _verdict, not
    # raw strings: a still-running node has not disagreed with anything.
    def _disagrees(name):
        a, b = _verdict(check_runs[name]), _verdict(contexts[name])
        return a is not None and b is not None and a != b
    disagreeing = sorted(n for n in set(check_runs) & set(contexts)
                         if _disagrees(n))
    if disagreeing:
        blockers.append(
            "One name, two verdicts: " + ", ".join(disagreeing) + " — a "
            "check run and a commit status disagree, and node order must "
            "never decide a merge.")
    # Required checks are CheckRun nodes specifically: REQUIRED_CHECKS
    # is aligned against workload ci.yml job names, and a commit status
    # is not a workflow run — anything holding statuses:write can post
    # one (Issue #28).
    for req in REQUIRED_CHECKS:
        if req not in check_runs:
            note = (" A commit status carries this name, but a status is "
                    "not the workflow run." if req in contexts else "")
            blockers.append(f"Required check {req!r} is absent — absent is "
                            f"not green.{note}")
        elif check_runs[req] in PENDING_STATES:
            pending.append(f"Required check {req!r} is still running "
                           f"({check_runs[req] or 'IN_PROGRESS'}).")
        elif check_runs[req] != "SUCCESS":
            blockers.append(f"Required check {req!r} is "
                            f"{check_runs[req] or 'UNKNOWN'}, not SUCCESS.")
    # Everything else — non-required check runs, plus every commit
    # status (a status never IS a required check, even sharing the name;
    # Issue #28) — is judged per node. The old single merged view let a
    # decided check run hide a same-named status still mid-flight
    # (recovered review, PR #34). A failing status on a required name
    # stays out of bad_others: decided disagreements were refused above
    # and a failing required run is already blocked by name.
    others = [(n, s) for n, s in check_runs.items()
              if n not in REQUIRED_CHECKS] + list(contexts.items())
    bad_others = sorted({n for n, s in others if _verdict(s) == "bad"
                         and n not in REQUIRED_CHECKS})
    pending_others = sorted({n for n, s in others
                             if _verdict(s) is None} - set(bad_others))
    if pending_others:
        pending.append("Still running: " + ", ".join(pending_others))
    if bad_others:
        blockers.append("Failing checks: " + ", ".join(bad_others))
    if not any((body or "").lstrip().startswith(REVIEW_MARKER)
               for body in comment_bodies):
        blockers.append("No reviewer-pass comment found — a fresh-context "
                        "reviewer must post one, with the marker heading "
                        "on its first line (see CLAUDE.md). No comment, "
                        "no merge.")
    return blockers, pending


def _gh(args, env):
    return subprocess.run(["gh"] + args, check=True, capture_output=True,
                          text=True, env=env).stdout


def _fetch_rollup(owner, repo, sha, env):
    """The CI-status rollup, read as two REST calls (Issue #33) and
    reshaped into the same CheckRun/StatusContext node list the GraphQL
    statusCheckRollup field used to produce, so evaluate() and
    _split_rollup() need not know which API the data came from. Case is
    left as REST returns it (lowercase) — _verdict() upcases whatever
    it is handed, GraphQL or REST alike.
    """
    runs = json.loads(_gh(
        ["api", f"repos/{owner}/{repo}/commits/{sha}/check-runs"], env))
    combined = json.loads(_gh(
        ["api", f"repos/{owner}/{repo}/commits/{sha}/status"], env))
    # A 2xx response is not proof of the expected shape: raising here on
    # a missing key sends a malformed/unexpected body through the same
    # transport-failure path as a thrown gh error, rather than silently
    # reading it as "this commit has zero checks" (main()'s caller
    # widens its except clause to catch this alongside CalledProcessError).
    if "check_runs" not in runs or "statuses" not in combined:
        raise ValueError(
            "check-runs/status response is missing its expected key — "
            "not the shape these endpoints document, so the rollup "
            "cannot be trusted for a merge decision.")
    nodes = [{"__typename": "CheckRun", "name": c.get("name"),
             "conclusion": c.get("conclusion"), "status": c.get("status")}
            for c in runs["check_runs"]]
    nodes += [{"__typename": "StatusContext", "context": s.get("context"),
              "state": s.get("state")}
             for s in combined["statuses"]]
    return nodes


def _transport_failure(err):
    print("TRANSPORT FAILURE — nothing was merged.")
    detail = (getattr(err, "stderr", "") or str(err)).strip()
    if detail:
        print(detail)
    print("Do NOT merge by hand as a workaround — fix the cause or put "
          "it in the needs-Steve digest.")
    return 3


def _credential_failure(detail):
    print("CREDENTIAL FAILURE — nothing was merged.")
    print(detail)
    print("Do NOT merge by hand as a workaround, and do not fall back to "
          "another credential — fix the cause or put it in the "
          "needs-Steve digest.")
    return 4


def main(argv):
    if len(argv) != 2 or not argv[1].isdigit():
        print(__doc__)
        return 2
    number = argv[1]
    try:
        owner, repo = _origin()
        gh_token = _gh_token_module()
        token, _ = gh_token.mint(owner, [repo], INSPECT_PERMISSIONS)
    except Exception as err:
        # Deliberately broad, and it must stay that way: exit 4 is the
        # "nothing was merged, and not because the PR was blocked" signal.
        # A traceback escaping here would exit 1 — the same status as a
        # legitimate refusal — so an unattended run could not tell a
        # network blip from a blocked PR, and none of the text below
        # would print.
        return _credential_failure(str(err))
    env = dict(os.environ, GH_TOKEN=token, GITHUB_TOKEN=token)
    try:
        pr = json.loads(_gh(["pr", "view", number,
                             "--json", ",".join(FIELDS)], env))
    except subprocess.CalledProcessError as err:
        return _transport_failure(err)
    # A field that did not resolve is a permission gap, not a state of
    # the PR: null means the token could not see it, and "could not see"
    # must never be reported as "absent is not green" or "no reviewer
    # pass" (Issue #29). mint() refuses a token GitHub grants short of
    # the request (gh_token.py), so a rollup that resolved non-null is
    # complete — required checks missing from it are genuinely absent,
    # never silently omitted.
    unresolved = [f for f in UNRESOLVED_NULL_FIELDS if pr.get(f) is None]
    if unresolved:
        return _credential_failure(
            "The inspect token could not resolve "
            + ", ".join(unresolved)
            + " — a permission gap, not a blocked PR. The decision needs "
              "those fields; fix the credential rather than reading their "
              "absence as a refusal.")
    try:
        pr["statusCheckRollup"] = _fetch_rollup(owner, repo,
                                                pr["headRefOid"], env)
    except (subprocess.CalledProcessError, ValueError) as err:
        # ValueError covers json.loads on a malformed 2xx body and the
        # shape check inside _fetch_rollup — both are "the data can't be
        # trusted", same as a thrown gh error, never a silent empty
        # rollup that would misread as "this commit has zero checks."
        return _transport_failure(err)
    bodies = [c.get("body", "") for c in pr.get("comments") or []]
    blockers, pending = evaluate(pr, bodies)
    if blockers:
        print(f"REFUSED — PR #{number} is not mergeable to dev:")
        for b in blockers:
            print(f"  - {b}")
        for p in pending:
            print(f"  - (also not decided yet: {p})")
        return 1
    if pending:
        print(f"NOT DECIDED YET — PR #{number} has checks still running:")
        for p in pending:
            print(f"  - {p}")
        print("Nothing was merged and nothing was refused — a running "
              "check is not a failing one. Re-run once they settle.")
        return 5
    try:
        token, _ = gh_token.mint(owner, [repo], MERGE_PERMISSIONS)
    except Exception as err:
        return _credential_failure(str(err))
    env = dict(os.environ, GH_TOKEN=token, GITHUB_TOKEN=token)
    try:
        _gh(["pr", "merge", number, "--squash", "--delete-branch"], env)
    except subprocess.CalledProcessError as err:
        # --delete-branch runs AFTER the merge commits (remote ref
        # deletion, then a local checkout of the default branch — which
        # fails when run from the claude/* branch being merged). A
        # non-zero exit here does not mean nothing merged: re-read the
        # PR before choosing the message, or an unattended agent is told
        # "nothing was merged" while dev already carries the change
        # (Issue #29).
        state = None
        try:
            state = json.loads(_gh(["pr", "view", number, "--json", "state"],
                                   env)).get("state")
        except Exception:
            pass
        if state == "MERGED":
            print(f"Merged PR #{number} to dev (squash), but cleanup after "
                  f"the merge failed:")
            detail = (err.stderr or "").strip()
            if detail:
                print(detail)
            print("The merge LANDED — do not retry it and do not treat "
                  "this as a transport failure. If the branch survived, "
                  "delete it; if the local checkout is on it, that is why "
                  "the cleanup step failed.")
            return 0
        return _transport_failure(err)
    print(f"Merged PR #{number} to dev (squash) and deleted its branch.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
