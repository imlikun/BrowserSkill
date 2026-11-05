# Controller identity regression

This regression exercises the built CLI, daemon and extension in a newly created browser profile and isolated daemon home. Use **only a trusted test CLI**: the runner executes the configured binary, and its capability response is not a security boundary against a malicious executable.

The extension is copied into the temporary test home and Chrome loads only that private copy. Chromium may modify its copy while loading it; the runner does not load or modify the installed extension directory. The copied bundle is checked again for the isolated daemon endpoint before startup. The test cleans up its temporary browser profile and test home.

Set `BSK_IDENTITY_CLI`, `BSK_IDENTITY_CHROME`, `BSK_IDENTITY_PORT` (a dedicated non-default port), and optionally `BSK_IDENTITY_EXTENSION` to the built extension directory. The extension bundle must use exactly that isolated port. Run `node evals/browser/cases/regression/controller-identity/run.mjs` or use `--self-test` for offline checks without launching a browser or daemon.

The runner requires CDP extension loading: it matches the extension worker by the exact ID returned by `Extensions.loadUnpacked` and verifies `chrome.runtime.id` after attachment. Setting `BSK_IDENTITY_EXTENSION_VIA_CDP=0` fails closed because the runner cannot securely establish which extension worker belongs to the copy. Browser, daemon and port must be dedicated to this test, not an existing user profile or shared service.
