---
name: pispark
description: How to work well inside PiSpark, the web workspace this session runs in. Covers presenting replies so they read well in a browser or on a phone, files you make for the person, naming the session, and PiSpark's tools for later, parallel or background work. Read it when deciding how to present a result or which PiSpark tool fits.
---

# Working in PiSpark

PiSpark hosts this Pi session and shows it to a person in a web page. They may be on a desktop, or on a phone with a narrow screen. The session keeps running on the server when they close the page, and they can come back to it later.

## What the person sees

- **Your replies** are rendered as Markdown, including headings, lists, tables, links and fenced code blocks with syntax highlighting. Raw HTML is not rendered, and links open in a new tab.
  - Give code blocks a language (` ```ts `).
  - Keep paragraphs short and lead with the answer.
  - Prefer a short list or a small table to a long paragraph when it reads better on a phone.
- **Your tool calls** show as quiet one-line activities ("Read 3 files", "Ran 2 commands"), which the person can open. Edits show as a diff. Don't repeat in prose what a diff or a tool's output already shows; say what it means.
- **Thinking** is folded away under a label.
- **Questions** an extension asks through Pi's UI (confirmations, choices) appear as a card the person answers. The run waits until then.

## Files for the person

When you make something the person will keep or open (a report, an image, a chart, a PDF, a CSV, an export), save it in this session's files folder. The system prompt gives its path. Files the person attached to their messages are there too. PiSpark shows that folder to the person as the session's files.

- Give the files clear names (`trip-plan.md`, `sales-by-month.png`).
- Changes to the person's project (source code, configuration) belong in the project, not here.
- Scratch files and intermediate outputs don't belong here either.
- After saving, mention the file by name in your reply.

## Naming the session

In your first reply, once its purpose is clear, give the session a short title of a few words with `pispark_set_title`. Change it only when the topic really changes. If the person named the session themselves, their name stays.

## PiSpark's tools

These tools exist only while they are active for this session.

- **`pispark_schedule`:** when the person asks for something later or repeatedly ("check again in an hour", "every weekday at 9"). PiSpark asks them to confirm.
- **`pispark_session`:** for work that can run on its own, such as research, a long job, or one of several parallel parts. Start another session and carry on; its answer arrives here as a message later.
- **`pispark_process`:** for commands that run long or never end on their own, such as dev servers, watchers, or long builds and tests. Run them in the background instead of `bash`, and wait for a ready line with `wait_for`.
- **`pispark_report`:** only in a session another session started. Raise something the starting session must know or act on.

## Extensions

PiSpark can show an extension's own web components: panels, views and controls in the session. See the `pispark-extensions` skill when the person wants a custom view, a dashboard, a control or a new tool for their work.
