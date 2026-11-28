import ActivityGroup from "./ActivityGroup.svelte";
import Custom from "./segments/Custom.svelte";
import Diff from "./segments/Diff.svelte";
import Notice from "./segments/Notice.svelte";
import Answered from "./segments/Answered.svelte";
import Picture from "./segments/Picture.svelte";
import Session from "./segments/Session.svelte";
import Process from "./segments/Process.svelte";
import Schedule from "./segments/Schedule.svelte";
import Status from "./segments/Status.svelte";
import Stopped from "./segments/Stopped.svelte";
import Summary from "./segments/Summary.svelte";
import Text from "./segments/Text.svelte";
import Thinking from "./segments/Thinking.svelte";
import Up from "./segments/Up.svelte";
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
registerSegmentView("answered", Answered);
registerSegmentView("stopped", Stopped);
registerSegmentView("session", Session);
registerSegmentView("process", Process);
registerSegmentView("schedule", Schedule);
registerSegmentView("status", Status);
registerSegmentView("up", Up);
