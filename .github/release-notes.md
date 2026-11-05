Alcyo Shorts turns a long stream into captioned 9:16 shorts. Each stream is a
chat: the coding agent you're signed in to (Claude Code, Grok or Codex)
proposes shorts as cards, you reply to change them, or open the editor.
Video and audio never leave your computer.

## Download

- **macOS (Apple silicon):** `Alcyo-Shorts-<version>-mac-arm64.dmg`
- **Windows (x64):** `Alcyo-Shorts-<version>-win-x64.exe`
- `SHA256SUMS.txt` has the checksum of each file.

Both were built and tested by CI from this tag: checks, unit tests, and the
end-to-end tests on the packaged app.

## First open

Neither build is signed with a paid certificate yet, so the first open needs
one extra step.

- **macOS:** open the dmg and drag Alcyo Shorts to Applications. Open it once;
  macOS says it can't check the app. Open System Settings > Privacy &
  Security, scroll to the message about Alcyo Shorts, and click **Open
  Anyway**. Later opens work normally.
- **Windows:** run the installer. If SmartScreen says "Windows protected your
  PC", click **More info**, then **Run anyway**.

## Try it without an agent

On first run, click **Skip for now** on Setup, then **Open the demo stream**.
It has three shorts, a chat revision and an editor version, and you can
render a short without any agent, key, network or model. The README has the
full steps.

Only download videos you own or have permission to use.
