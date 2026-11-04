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
import { Onboarding } from "./profile/Onboarding";
import { SetupPage } from "./setup/SetupPage";
import { Layout } from "./shell/Layout";
import { Home, NotFound } from "./shell/pages";
import { StreamThread } from "./streams/StreamThread";
import { RenderQueuePage } from "./shell/RenderQueue";
import { Editor } from "./editor/Editor";

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });

const streamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId",
  component: StreamThread,
});

// A short or a version opens the thread at its card (plan section 5).
const shortRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId/short/$shortId",
  component: StreamThread,
});
const versionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId/short/$shortId/v/$version",
  component: StreamThread,
});
const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId/short/$shortId/v/$version/edit",
  component: Editor,
});

// Anything else below a stream (the source view comes later) shows the thread.
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

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: Onboarding,
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
  shortRoute,
  versionRoute,
  editRoute,
  streamChildRoute,
  rendersRoute,
  setupRoute,
  onboardingRoute,
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
