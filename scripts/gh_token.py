#!/usr/bin/env python3
"""Mint a short-lived, least-privilege GitHub App installation token.

Every GitHub credential this process uses comes from here. Callers name
the repositories and the permissions, and get a token carrying those and
nothing else. This is a paved path, not a wall -- the capability is the
private key, and anything holding it can request whatever the installation
allows. What this module constrains is the process's own conduct
(governance/grants.md, Grant 4).

Two limits are worth stating because they are counter-intuitive:

* A token's repository list bounds REPOSITORY-level permissions only.
  ORG-level permissions are installation-wide and ignore it entirely --
  verified against the API, not inferred. So org-level permission is not
  offered as something a caller may request: `create_repo()` is the one
  operation that uses it, minting and discarding internally, and the
  command line refuses org-level permissions outright.

* `administration` is what applies a ruleset, and therefore what can
  remove one -- the human-only merge gate lives inside the same permission
  bootstrap needs to create it. GitHub bundles repository deletion in
  there too and will not let us split it off.

Elevated permissions require a stated reason and append an audit record.
If the record cannot be written, nothing is minted: no record, no
elevation.

This tool never prints a token itself -- in this environment stdout lands
in a transcript on disk and in model context, where it would outlive the
command that needed it. It cannot stop the command it runs from printing
one: the child receives the token in its environment, so `-- env` or
`-- gh auth token` would expose it. That is a limit of handing a
credential to a child process at all, not something a flag removes. Do
not use this tool to dump an environment.

Configuration (no value is ever hardcoded):
    SOFA_APP_ID     the App's numeric ID
    SOFA_APP_KEY    path to its PEM private key (default ~/.config/sofa-claude/app.pem)
    SOFA_AUDIT_LOG  elevation record (default ~/.config/sofa-claude/elevations.log)

Usage:
    gh_token.py --account ORG --repos a,b --perm contents=write -- gh pr list
    gh_token.py --account ORG --repos a --perm administration=write \
                --reason "bootstrap: apply protect-main ruleset" -- gh api ...
"""

import argparse
import base64
import datetime
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"
DEFAULT_KEY = "~/.config/sofa-claude/app.pem"
DEFAULT_AUDIT = "~/.config/sofa-claude/elevations.log"

# Installation-wide: a token's repository list does NOT bound these.
ORG_LEVEL = ("organization_administration", "members", "organization_secrets",
             "organization_projects", "organization_hooks",
             "organization_self_hosted_runners", "organization_user_blocking")
# Every mint naming one of these is recorded, at any level: `actions:read`
# is log and artifact access, `secrets:read` enumerates a secret
# inventory, and the audit log is Grant 4's detection control -- narrowing
# what it sees to save a few lines a day is a bad trade. A *reason* is
# demanded only for the write levels, so routine CI reads stay frictionless
# while the trail stays intact; a reader wanting only writes can filter the
# recorded permissions dict.
ELEVATED = ORG_LEVEL + ("administration", "secrets", "actions", "workflows")
# Deny-by-default, like every other refusal here: anything that is not
# exactly `read` counts as a write. An allowlist of write levels would let
# an unanticipated value ("true", a level GitHub adds later) fall through
# as harmless on the one permission that can remove a ruleset.
READ_LEVEL = "read"


def recorded_permissions(permissions):
    """Names worth an audit record -- any level."""
    return sorted(name for name in permissions if name in ELEVATED)


def elevated_permissions(permissions):
    """Names that additionally require a stated reason (write levels)."""
    return sorted(name for name, level in permissions.items()
                  if name in ELEVATED and str(level).strip().lower() != READ_LEVEL)


class TokenError(RuntimeError):
    """Raised with an actionable message; never carries a credential."""


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def app_jwt(app_id, key_path, now=None):
    """Sign a ~9-minute JWT with the App's private key, via openssl."""
    path = pathlib.Path(os.path.expanduser(key_path))
    if not path.exists():
        raise TokenError(
            f"App private key not found at {path}. Set SOFA_APP_KEY, or place "
            f"the key there with mode 600. Generating or moving keys is "
            f"Steve's ceremony -- do not create one to get past this.")
    if not os.access(path, os.R_OK):
        raise TokenError(f"App private key at {path} exists but is unreadable.")
    now = int(time.time() if now is None else now)
    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps(
        {"iat": now - 60, "exp": now + 540, "iss": str(app_id)}).encode())
    signing_input = header + b"." + payload
    try:
        proc = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(path)],
                              input=signing_input, capture_output=True)
    except FileNotFoundError:
        raise TokenError("openssl not found on PATH; cannot sign the App JWT.")
    if proc.returncode != 0:
        raise TokenError(
            f"Signing the App JWT with {path} failed -- is it a valid RSA "
            f"private key? openssl: {proc.stderr.decode().strip()[:200]}")
    return (signing_input + b"." + _b64(proc.stdout)).decode()


def api(path, bearer, method="GET", payload=None):
    request = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": "Bearer " + bearer,
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "User-Agent": "sofa-claude"})
    try:
        with urllib.request.urlopen(request) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = json.loads(err.read()).get("message", "")
        except Exception:
            pass
        raise TokenError(f"GitHub {err.code} on {method} {path}: {detail}")
    except urllib.error.URLError as err:
        # DNS, offline, TLS. Must surface as TokenError like any other
        # credential failure: a traceback escaping here would reach the
        # caller as an unhandled crash rather than a loud, typed refusal.
        raise TokenError(f"Cannot reach GitHub for {method} {path}: {err.reason}")
    except ValueError as err:
        raise TokenError(f"Unparseable response from {method} {path}: {err}")


def installation_id(account, jwt):
    """The App's installation on `account` (an org or user login).

    Paginated: the default page size is 30, and reporting "no installation"
    for an account on page two would send the operator off to redo a
    ceremony that is already done.
    """
    page, per_page = 1, 100
    while True:
        batch = api(f"/app/installations?per_page={per_page}&page={page}", jwt)
        for inst in batch:
            if ((inst.get("account") or {}).get("login") or "").lower() == account.lower():
                return inst["id"]
        if len(batch) < per_page:
            break
        page += 1
    raise TokenError(
        f"The App has no installation on {account!r}. Install it there first "
        f"-- installing an App is Steve's step, not Claude's.")


def record_elevation(account, repositories, permissions, reason,
                     audit_path=None, event="requested"):
    """Append a durable audit record. Fails closed: no record, no token.

    Written twice per elevation: `requested` before minting, so a failure
    to record blocks the mint, and `granted` once a token actually exists.
    A lone `requested` therefore means the elevation was authorised but
    never happened -- a missing key, a rejected call -- which keeps the log
    from implying access that was never obtained.
    """
    path = pathlib.Path(os.path.expanduser(
        audit_path or os.environ.get("SOFA_AUDIT_LOG") or DEFAULT_AUDIT))
    entry = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "event": event,
        "account": account,
        "repositories": sorted(repositories),
        "permissions": dict(sorted(permissions.items())),
        "reason": reason.strip(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    except OSError as err:
        raise TokenError(
            f"Refusing to mint: the elevation could not be recorded at {path} "
            f"({err}). An elevation no one can audit later is not a control "
            f"(Grant 4) -- fix the path or the permissions, do not proceed.")
    return entry


def mint(account, repositories, permissions, reason=None, app_id=None,
         key_path=None, _allow_org_level=False):
    """Return (token, expires_at) carrying exactly `permissions` on `repositories`.

    "Exactly" is checked against what GitHub reports granting, not
    assumed from a 2xx; a mismatched grant refuses instead of returning.

    Both scoping arguments are required and must be non-empty: there is
    deliberately no way to ask for everything the installation can do.
    Org-level permissions are rejected here -- they cannot be bounded by
    the repository list, so they are reachable only through the single
    operation that needs them (`create_repo`).
    """
    if not repositories:
        raise TokenError(
            "Refusing to mint: no repositories named. Least privilege is the "
            "only path -- name the repositories this task actually touches.")
    if not permissions:
        raise TokenError(
            "Refusing to mint: no permissions named. Least privilege is the "
            "only path -- name the permissions this task actually needs.")
    org_level = sorted(p for p in permissions if p in ORG_LEVEL)
    if org_level and not _allow_org_level:
        raise TokenError(
            f"Refusing to mint {', '.join(org_level)}: organization-level "
            f"permissions are installation-wide and are NOT bounded by the "
            f"repository list, so there is no such thing as a scoped one. "
            f"They are reachable only through create_repo(), which mints and "
            f"discards internally (Grant 4).")
    recorded = recorded_permissions(permissions)
    elevated = elevated_permissions(permissions)
    if elevated and not (reason or "").strip():
        raise TokenError(
            f"Refusing to mint {', '.join(elevated)} without a stated reason. "
            f"`administration` carries repository deletion and ruleset "
            f"removal, which GitHub does not let us split off. Pass --reason "
            f"naming the single call this is for.")
    app_id = app_id or os.environ.get("SOFA_APP_ID")
    if not app_id:
        raise TokenError("SOFA_APP_ID is not set; it is the App's numeric ID.")
    key_path = key_path or os.environ.get("SOFA_APP_KEY") or DEFAULT_KEY
    if recorded:
        # Fail closed only where the control actually lives: an *elevation*
        # must not happen unrecorded. A read-level record is forensic, and
        # letting an unwritable log turn every routine merge into a
        # credential failure would be a far larger outage than the gap it
        # closes -- so that case warns loudly and proceeds.
        try:
            entry = record_elevation(account, repositories, permissions,
                                     reason or "")
        except TokenError:
            if elevated:
                raise
            print("[gh_token] WARNING: could not record a read-level mint; "
                  "proceeding. Elevated mints would refuse here.",
                  file=sys.stderr)
            entry = None
        if elevated and entry:
            print(f"[gh_token] elevated ({', '.join(elevated)}) recorded: "
                  f"{entry['reason']}", file=sys.stderr)
    jwt = app_jwt(app_id, key_path)
    result = api(f"/app/installations/{installation_id(account, jwt)}/access_tokens",
                 jwt, "POST",
                 {"repositories": list(repositories), "permissions": dict(permissions)})
    # "Carrying exactly `permissions`" is verified, not assumed: GitHub
    # normally 422s a request the installation cannot grant, but a token
    # granted short would read downstream as silently missing data (a
    # rollup with nodes omitted misreported as "absent"), and one granted
    # broad is not least privilege. metadata:read is tolerated — GitHub
    # attaches it to every installation token implicitly.
    granted = result.get("permissions") or {}
    short = {n: l for n, l in permissions.items() if granted.get(n) != l}
    extra = {n: l for n, l in granted.items()
             if n not in permissions and (n, l) != ("metadata", "read")}
    if short or extra:
        raise TokenError(
            f"GitHub granted a different permission set than requested "
            f"(requested {dict(permissions)!r}, granted {granted!r}). A "
            f"token carrying other than what was named must not be used. "
            f"Fix the installation's grants (App → Install → this "
            f"repository) and re-run; do not proceed on an unverified "
            f"surface.")
    if recorded:
        try:
            record_elevation(account, repositories, permissions, reason or "",
                             event="granted")
        except TokenError:
            if elevated:
                raise
    return result["token"], result.get("expires_at")


def create_repo(org, name, reason, scope_repo, private=True,
                app_id=None, key_path=None):
    """Create `org/name`. The only operation permitted org-level access.

    The org-admin token is minted, used once, and dropped -- never
    returned, so no caller can reuse it. GitHub requires BOTH
    organization-level and repository-level administration here (verified
    2026-08-20).

    `scope_repo` must name an **existing** repository. The token cannot be
    scoped to the repo being created -- it does not exist yet, and GitHub
    rejects a repository list naming anything absent -- and it cannot be
    scoped to nothing, since an empty list silently means all. So the
    repository-level half of this token lands on whichever existing repo
    is named: pass the throwaway scratch repo, whose admin exposure costs
    nothing. The org-level half is installation-wide regardless; no
    scoping arrangement changes that (Grant 4).

    Consequence worth knowing at bootstrap time: an org with no
    repositories at all has nothing to scope to, so its first repository
    is Steve's to create by hand.
    """
    if not (reason or "").strip():
        raise TokenError("create_repo requires a stated reason.")
    if not scope_repo or scope_repo == name:
        raise TokenError(
            f"create_repo needs scope_repo to name an EXISTING repository, "
            f"not {name!r}, which does not exist yet. GitHub rejects a "
            f"repository list containing anything absent, and an empty list "
            f"silently means all -- pass the throwaway scratch repo.")
    token, _ = mint(org, [scope_repo],
                    {"organization_administration": "write",
                     "administration": "write"},
                    reason=reason, app_id=app_id, key_path=key_path,
                    _allow_org_level=True)
    return api(f"/orgs/{org}/repos", token, "POST",
               {"name": name, "private": bool(private), "auto_init": True})


def _permission(arg):
    if "=" not in arg:
        raise argparse.ArgumentTypeError(
            f"--perm expects name=level, e.g. contents=write (got {arg!r})")
    name, _, level = arg.partition("=")
    return name.strip(), level.strip()


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Run a command under a scoped, short-lived GitHub App token.")
    parser.add_argument("--account", required=True,
                        help="org or user login the App is installed on")
    parser.add_argument("--repos", required=True,
                        help="comma-separated repository names (not full names)")
    parser.add_argument("--perm", required=True, action="append", type=_permission,
                        metavar="NAME=LEVEL", help="repeatable; e.g. contents=write")
    parser.add_argument("--reason", help="required for elevated permissions")
    parser.add_argument("command", nargs=argparse.REMAINDER,
                        help="-- CMD ARGS: run CMD with GH_TOKEN set")
    args = parser.parse_args(argv)

    # argparse.REMAINDER keeps the separator; drop only that leading one,
    # never a `--` the child command means for itself (e.g. `git diff -- path`).
    command = args.command[1:] if args.command[:1] == ["--"] else list(args.command)
    if not command:
        parser.error("give a command after -- ; this tool runs a command "
                     "under a token, it does not hand the token out")
    try:
        token, _ = mint(args.account,
                        [r.strip() for r in args.repos.split(",") if r.strip()],
                        dict(args.perm), args.reason)
    except TokenError as err:
        print(f"CREDENTIAL FAILURE -- nothing was minted.\n{err}", file=sys.stderr)
        return 2
    env = dict(os.environ, GH_TOKEN=token, GITHUB_TOKEN=token)
    return subprocess.run(command, env=env).returncode


if __name__ == "__main__":
    sys.exit(main())
