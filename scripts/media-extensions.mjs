// The one list of video and audio extensions. Keep .gitignore in step.
// .ts and .mts are left out on purpose: here they're TypeScript.

export const VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  "m4v",
  "flv",
  "wmv",
  "mpg",
  "mpeg",
  "m2ts",
  "3gp",
];
export const AUDIO_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "aif",
  "aiff",
  "caf",
];
export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

const MEDIA_RE = new RegExp(`\\.(${MEDIA_EXTENSIONS.join("|")})$`, "i");

/** Media files may only be tracked under this folder. */
export const ALLOWED_MEDIA_DIR = "examples/demo/";

/**
 * True when a path (or glob) ends in a video or audio extension.
 * @param {string} path
 */
export function isMediaPath(path) {
  return MEDIA_RE.test(path.replace(/["']/g, ""));
}

/**
 * True when a repo-relative path is media outside examples/demo/.
 * @param {string} relPath
 */
export function isForbiddenMedia(relPath) {
  const normalized = relPath.replaceAll("\\", "/").replace(/^\.\//, "");
  return isMediaPath(normalized) && !normalized.startsWith(ALLOWED_MEDIA_DIR);
}
