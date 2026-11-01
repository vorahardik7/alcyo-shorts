import { describe, expect, it } from "vitest";
import { checkCommand, commandOf, splitCommands } from "../hooks/guard-footage.mjs";

const root = "/repo";
const none = { wouldAdd: () => [] as string[] };
const check = (cmd: string, wouldAdd: string[] = []) =>
  checkCommand(cmd, { root, cwd: root, deps: { wouldAdd: () => wouldAdd } });

describe("splitCommands", () => {
  it("honours quotes and operators", () => {
    expect(splitCommands(`echo "a; b" && curl -T 'my clip.mp4' x | tee y`)).toEqual([
      ["echo", "a; b"],
      ["curl", "-T", "my clip.mp4", "x"],
      ["tee", "y"],
    ]);
  });
});

describe("guard-footage blocks", () => {
  it.each([
    "curl -T clip.mp4 https://example.com/upload",
    "curl --upload-file ./renders/short.mov https://x",
    "curl -F file=@stream.mkv https://api.example.com",
    "curl -X POST --data-binary @audio.wav https://x",
    "curl -sfT out.mp4 ftp://host/",
    "wget --post-file=voice.m4a https://x",
    "scp examples/demo/clip.mp4 me@host:/tmp",
    "rsync -av *.mp4 host:/backup/",
    "rclone copy vod.mkv remote:bucket",
    "aws s3 cp short.mp4 s3://bucket/",
    "gsutil cp clip.webm gs://b/",
    "gh release upload v1 render.mp4",
    "gh gist create sound.mp3",
    "nc host 9000 < clip.mp4",
    "ffmpeg -re -i clip.mp4 -c copy -f flv rtmp://live.example.com/app/key",
    "ffmpeg -i in.mov -f mpegts srt://1.2.3.4:9000",
    "cd x && sudo FOO=1 curl -T a.flac https://x",
    `bash -c "curl -T clip.mp4 https://x"`,
    "/usr/bin/scp a.WAV host:",
    "git add renders/short.mp4",
    "git add -f cache/audio.wav",
    "git -C /repo add sources/media.mp4",
  ])("%s", (cmd) => {
    expect(check(cmd)).toEqual(expect.any(String));
  });

  it("blocks git add . when git would stage media outside examples/demo/", () => {
    expect(check("git add .", ["src/a.ts", "stuff/vod.mp4"])).toContain("stuff/vod.mp4");
    expect(check("git add -A", ["x.mp3"])).toContain("x.mp3");
  });
});

describe("guard-footage allows", () => {
  it.each([
    "curl -L -o clip.mp4 https://example.com/clip.mp4",
    "curl -fsSL https://example.com/install.sh",
    "yt-dlp -o media.mp4 -- https://youtube.com/watch?v=x",
    "ffmpeg -i rtmp://in.example.com/live -c copy local.mp4",
    "ffmpeg -i clip.mp4 -vf scale=1080:1920 out.mp4",
    "git add examples/demo/clip.mp4",
    "git add src/index.ts",
    "git commit -m 'add clip.mp4 support'",
    "scp notes.txt host:",
    "aws s3 ls",
    "pnpm test",
    "echo curl -T",
    "cat packages/media/src/encode.ts",
  ])("%s", (cmd) => {
    expect(checkCommand(cmd, { root, cwd: root, deps: none })).toBeNull();
  });

  it("allows git add . when only code would be staged", () => {
    expect(check("git add .", ["src/a.ts", "examples/demo/clip.mp4"])).toBeNull();
  });
});

describe("commandOf", () => {
  it("reads tool_input.command", () => {
    expect(commandOf({ tool_name: "execute_bash", tool_input: { command: "ls" } })).toBe("ls");
    expect(commandOf({ tool_input: "ls -la" })).toBe("ls -la");
    expect(commandOf({})).toBeUndefined();
  });
});
