# Identify the agent controlling a browser session

Pass display labels when starting a session:

```sh
bsk session start --agent-name Codex --project "Search service" --controller-color '#2563eb' --json
bsk session start --agent-name Claude --project "Payments" --json
bsk session list
bsk status --json
```

The collaboration overlay shows the agent name, project label, session ID and a
color marker. Pause/resume controls name the agent. Without `--agent-name` or
`--controller`, the overlay keeps the BrowserSkill title and still shows the
session ID. When available, the overlay also displays the Chrome window and tab
IDs from the controlled tab. These are browser-assigned IDs, not sequential window
numbers; they may change when windows or tabs are recreated. An omitted color is
selected from a palette seeded by the session ID, avoiding colors already used by
live sessions. Colors can repeat after the six-color palette is exhausted
or when explicitly requested, so text labels and session IDs always remain visible.

`--controller` is a compatibility spelling for `--agent-name`, and
`--controller-project` for `--project`. Either spelling can be used with either
project spelling, but specifying both names or both project options is an error,
including when their values are identical. `--project`, `--controller-project`,
and `--controller-color` require an explicit `--agent-name` or `--controller`.
`--name` remains a task name for local operation history; it is never used as a
controller label and does not satisfy that requirement.

Agent names accept 1–80 Unicode code points; project labels accept 1–120. Blank
labels and control characters are rejected. Explicit colors must be six-digit hex
(`#RRGGBB`). Quote hex colors in shells where `#` starts a comment. Labels are
rendered as text. They are caller-supplied display information, not authenticated
identities or permissions. Avoid putting secrets or private filesystem paths in
these labels.

The DSH `bsk_session` tool's `start` action accepts `agentName`, `project`, and
`controllerColor` with the same meaning. Other clients can send an optional
`controller: { name, project?, color? }` in `session.start` / `tool.session_start`.
The daemon includes it in each session entry returned by `session.list`,
`system.status`, and recoverable request status. Retrying a tracked start with
different metadata is rejected under the existing request-id rules.

Install the updated CLI/daemon and extension together to see the labels. The
metadata is additive: older clients can omit it, and older extensions may ignore
it. Session ownership, tab borrowing and the stop button keep their existing
behavior. Returning a tab or releasing a session clears its overlay identity;
navigation and overlay reinitialization obtain the current identity from the
extension's session registry. The feature adds no identity persistence across
terminated sessions or extension worker restarts.

Chrome/Edge's native debugger banner uses the installed extension's name and
cannot be customized per session. Identity is shown in BrowserSkill's own overlay.
The feature does not rewrite page/window titles or introduce control preemption.
Each session currently owns a separate Agent Window. The same native window is not
supported as a concurrent shared Agent Window for multiple sessions; moving a
controlled tab out can end its session. Do not interpret a label as evidence of
concurrent multi-session ownership of the same window. Agent processes are not
continuously monitored for termination: idle session cleanup and transport-loss
cleanup operate independently, and cleanup can fail. After an extension worker
restart, a page that has not refreshed its overlay state may retain an old
indicator; this edge case has not yet been verified or fixed. Check session status
rather than assuming immediate cleanup after a caller exits.

## Run the isolated browser regression

Build the CLI (`cargo build -p bsk --locked`) and extension with
`BSK_DAEMON_WS_URL=ws://127.0.0.1:52836 pnpm ext:build`. Set `BSK_IDENTITY_CLI` to
the built CLI executable, `BSK_IDENTITY_PORT=52836`, and `BSK_IDENTITY_CHROME` to
a Chromium executable that supports unpacked extension loading through CDP, then run:

```sh
node evals/browser/cases/regression/controller-identity/run.mjs
```

The regression launches its own browser with a temporary `--user-data-dir` and
uses a temporary `BSK_HOME` for daemon state. It sets `BSK_DISABLE_SKILL_SYNC=1`
for both daemon and CLI subprocesses: only the exact value `1` skips automatic
installed-skill synchronization and recovery, including the daemon, session start,
and doctor sync paths. Unset or other values retain normal behavior. With the
switch set, `bsk doctor` reports that installed-skill checks and synchronization
were skipped, rather than inferring that no skill is installed. The switch does not disable
explicit `install-skill` operations. `BSK_HOME` alone does not isolate
installed skills, which can live in the user's home or harness-specific locations.
Use a trusted CLI built from a revision that supports this switch; older binaries
ignore it. Before starting its daemon or browser, the regression checks the CLI's
offline `debug capabilities` response for `cli.capabilities.disable_skill_sync`.
This capability declaration is not authentication of an untrusted executable.

The regression also sets `BSK_AUTO_UPDATE=off` to prevent automatic binary
installation. The daemon may still check for updates over the network and write
an update-check cache in the temporary `BSK_HOME`, and may remove stale update
leftovers next to its executable. Point `BSK_IDENTITY_CLI` at the isolated
checkout's build, not an installed CLI. It reads the owned extension's instance
ID over CDP, selects that browser, and fails if another ID is already connected;
instance IDs are not authentication, so use a dedicated test port and trusted
local environment. The regression checks independent
identities, status metadata, legacy clients, navigation, narrow viewports, long
labels, and session cleanup. Screenshots and a JSON result are saved under
`evals/browser/results/controller-identity/`. Override `BSK_IDENTITY_PORT` together
with the build-time daemon URL if port 52836 is in use. Set
`BSK_IDENTITY_HEADFUL=1` to run the regression with a visible browser; the default
remains headless. The test checks the extension's configured URL and the spawned
daemon's PID and port before opening the test browser.
