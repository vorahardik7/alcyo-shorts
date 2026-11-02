// Routes from plan section 5 plus Setup and Settings sections, with hash
// history.
import { SETTINGS_SECTIONS, type SettingsSection } from "@alcyo/schema";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { SettingsPage } from "./settings/SettingsPage";
import { SetupPage } from "./setup/SetupPage";
import { Layout } from "./shell/Layout";
import { Home, NotFound } from "./shell/pages";
import { StreamThread } from "./streams/StreamThread";
import { RenderQueuePage } from "./shell/RenderQueue";

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });

const streamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId",
  component: StreamThread,
});

// Messages, shorts, versions, the editor and source moments all sit below a
// stream. Until specs 10 and 11 they show the stream's thread.
const streamChildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId/$",
  component: StreamThread,
});

const rendersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/renders",
  component: RenderQueuePage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => <SettingsPage section="profile" />,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/profile",
  component: () => <SettingsPage section="profile" />,
});

function isSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

const sectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  component: function SectionPage() {
    const { section } = sectionRoute.useParams();
    return isSection(section) ? <SettingsPage section={section} /> : <NotFound />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  streamRoute,
  streamChildRoute,
  rendersRoute,
  setupRoute,
  settingsRoute,
  profileRoute,
  sectionRoute,
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
