import ActivityGroup from "./ActivityGroup.svelte";
import Custom from "./segments/Custom.svelte";
import Diff from "./segments/Diff.svelte";
import Notice from "./segments/Notice.svelte";
import Picture from "./segments/Picture.svelte";
import Session from "./segments/Session.svelte";
import Stopped from "./segments/Stopped.svelte";
import Summary from "./segments/Summary.svelte";
import Text from "./segments/Text.svelte";
import Thinking from "./segments/Thinking.svelte";
import { registerSegmentView } from "./views.svelte";
import "./tool-views";

/**
 * PiSpark's own views of the conversation, registered through the same call an extension uses
 * for its own. Importing this module is what puts them in place.
 */
registerSegmentView("text", Text);
registerSegmentView("thinking", Thinking);
registerSegmentView("activity", ActivityGroup);
registerSegmentView("custom", Custom);
registerSegmentView("summary", Summary);
registerSegmentView("diff", Diff);
registerSegmentView("image", Picture);
registerSegmentView("svg", Picture);
registerSegmentView("notice", Notice);
registerSegmentView("stopped", Stopped);
registerSegmentView("session", Session);
