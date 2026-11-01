// Routes from plan section 5, with hash history. Spec 1 has placeholders for
// everything below a stream; later specs fill them in.
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Layout } from "./shell/Layout";
import { EmptyThread, NotFound, PlainPage, StreamPlaceholder } from "./shell/pages";
import { SettingsPage } from "./shell/SettingsPage";

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: EmptyThread,
});

const streamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId",
  component: StreamPlaceholder,
});

// Messages, shorts, versions, the editor and source moments all sit below a
// stream. Until the store exists (spec 4) they show the same placeholder.
const streamChildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$streamId/$",
  component: StreamPlaceholder,
});

const rendersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/renders",
  component: () => <PlainPage title="Render queue" body="No renders yet." />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/profile",
  component: () => (
    <PlainPage
      title="Creator profile"
      body="No creator profile yet. It's made during onboarding, after setup."
    />
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  streamRoute,
  streamChildRoute,
  rendersRoute,
  settingsRoute,
  profileRoute,
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
