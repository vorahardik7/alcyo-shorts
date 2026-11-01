// electron-vite import suffix: the default export is the bundled file's path.
declare module "*?modulePath" {
  const path: string;
  export default path;
}
