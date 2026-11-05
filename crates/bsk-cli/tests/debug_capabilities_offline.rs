//! Offline discovery must not start a daemon or change isolated state.
use std::{fs, process::Command};

#[test]
fn capabilities_advertise_sync_opt_out_without_side_effects() {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("bsk-home");
    let hermes = root.path().join("hermes");
    let kimi = root.path().join("kimi");
    fs::create_dir(&home).unwrap();
    for path in [&hermes, &kimi] {
        let skill = path.join("skills/browser-skill");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), b"unmodified skill sentinel").unwrap();
    }

    // Also exercise the non-JSON flag path through main's cached update hint.
    // BSK_HOME is empty, AUTO_UPDATE is off, and daemon autostart is forbidden.
    for json in [false, true] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_bsk"));
        command
            .args(["debug", "capabilities"])
            .env("BSK_HOME", &home)
            .env("BSK_AUTO_START", "0")
            .env("BSK_AUTO_UPDATE", "off")
            .env("BSK_DISABLE_SKILL_SYNC", "1")
            .env("HERMES_HOME", &hermes)
            .env("KIMI_CODE_HOME", &kimi);
        if json {
            command.arg("--json");
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["cli"]["capabilities"]["disable_skill_sync"], true);
        assert_eq!(value["discovery"], "cli_schema_only");
        assert!(value["extension"].is_null());
        assert_eq!(fs::read_dir(&home).unwrap().count(), 0);
        for path in [&hermes, &kimi] {
            let skill = path.join("skills/browser-skill");
            assert_eq!(
                fs::read(skill.join("SKILL.md")).unwrap(),
                b"unmodified skill sentinel"
            );
            assert_eq!(fs::read_dir(skill).unwrap().count(), 1);
        }
    }
}
