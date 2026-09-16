/** Shared state for HTML5 drag from the media bin to the timeline.
 * dataTransfer payloads are unreadable during `dragover`, so we stash the id here. */
export const dragMedia: { id: string | null } = { id: null };
