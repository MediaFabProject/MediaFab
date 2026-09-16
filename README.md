<p align="center">
  <img src="images/mediafab-logo-green-lavender-light.png" alt="MediaFab logo: green and lavender retro television beside a download arrow" width="180" />
</p>

<h1 align="center">MediaFab</h1>

<p align="center">
  A local browser-extension workflow for turning fresh playback captures into complete N_m3u8DL-RE commands, full subtitle sidecars, optional metadata and extras, and carefully sequenced single or queued media jobs.
</p>

<p align="center">
  <img src="images/badges/status-garden.svg" alt="Status: Active Development" />
  <img src="images/badges/platform-garden.svg" alt="Platform: Firefox on macOS" />
  <img src="images/badges/workflows-garden.svg" alt="Workflows: Single and Queue" />
  <img src="images/badges/license-garden.svg" alt="License: GPL-3.0" /><br />
  <img src="images/badges/metadata-providers-v7.svg" alt="Separate Optional Metadata Providers: Amazon Prime Video, BBC iPlayer, BroadwayHD, Crunchyroll, Disney+, HBO Max, MarqueeTV, Metropolitan Opera, Netflix, OperaVision, Paramount+, and PBS Great Performances" />
</p>

## Why This Project Was Created

MediaFab is made by a software developer who has also maintained a large
Jellyfin server for many years. After discovering a popular—and expensive—paid
application built around a similar idea and falling down a rabbit hole, the
question had to be asked: how much of that workflow could be figured out,
built, and shaped around the way tons of people maintain their libraries?

MediaFab began as a straightforward fork of
[DevLARLEY's excellent WidevineProxy2](https://github.com/DevLARLEY/WidevineProxy2),
which provided the foundation. The first changes focused on making that
foundation more comfortable to use: a redesigned graphical interface,
light and dark themes, clearer media and key controls, support for public media
captures so media work no longer had to be split between MediaFab and another
popular and wonderful browser extension and could instead remain entirely
within MediaFab, better command generation, and a subtitle workflow that could
save, convert, deduplicate, and correctly name external tracks that were not
originally being captured. From there, every improvement exposed another part
of the process that could be made faster, easier to understand, or more
complete.

MediaFab also optionally can work with
[Media Metadata and Extras Getter](https://github.com/MediaFabProject/Media-Metadata-and-Extras-Getter)
for films, series, episodes, programmes, and clips. That tool can use supported
public detail pages to match and rename completed media, organize television
episodes into seasons, and save Jellyfin-friendly NFO files, artwork, trailers,
gallery images, and other available extras. Or, for those archiving live
performances, MediaFab also works with
[Live Performance Metadata and Extras Getter](https://github.com/MediaFabProject/Live-Performance-Metadata-and-Extras-Getter),
which provides the corresponding metadata, artwork, trailers, extras, and
media-matching workflow for stage productions, opera, concerts, and other live
performances. Together, they turn a completed capture into something ready for
a carefully organized local library instead of leaving behind a generic media
file and a separate pile of manual work.

Queue Mode became the turning point. It grew the normal, proven MediaFab
workflow into a sequential episode queue: discover a supported series or enter
playing-page links manually, choose the episodes, and let one dedicated browser
tab capture and dispatch each short-lived job at the right moment. When Queue
Mode was finally tested and working from beginning to end, it was genuinely
exciting to have something comparable to—and, for this workflow, better
than—the paid alternative that started the whole rabbit hole.

Since the original fork, MediaFab has added:

- A redesigned, collapsible GUI with remembered settings, light and dark
  themes, and clearer controls for captured media, keys, commands, metadata,
  and companion execution;
- Capture and command generation for supported public HLS, DASH, Smooth
  Streaming, and verified direct MP4 sources alongside the inherited Widevine
  challenge, license, and content-key workflow, including no-key commands,
  detected runtimes, public HLS master-playlist recovery, and safe fallbacks
  when only a child playlist is available;
- Preservation of current request headers, authorization, cookies, referer
  details, keys, and user-selected N_m3u8DL-RE media options in each command,
  with displayed commands refreshed when those options change;
- External-subtitle discovery from browser requests and subtitle-specific API
  or manifest data, including authenticated downloads, text conversion,
  Jellyfin-friendly naming, duplicate removal, and rejection of proven
  signs/title-card or forced-only tracks when a full subtitle is available;
- Completion-aware cleanup and optional Media Metadata and Extras Getter or
  Live Performance Metadata and Extras Getter handoffs that wait for media and
  subtitle work, pass the finished output, and support automatic provider
  detail links where MediaFab can establish them safely, while recognized
  N_m3u8DL-RE work folders are removed only after success;
- The ability to work with the optional MediaFab Companion (not included in this
  repo) for the normal workflow, and the required MediaFab Companion
  for sequential jobs, with private temporary runners, concise Terminal
  progress, start and failure confirmation, pausing, cancellation, retries, and
  optional closing of successful Terminal windows;
- Queue Mode series discovery and manual queue creation for other playing-page
  links, season and episode selection, one-at-a-time fresh browser capture, and
  reuse of the normal command builder rather than a separate approximation.
  Queue Mode catalogue loading currently works for Amazon Prime
  Video, BBC iPlayer, Crunchyroll, Disney+, HBO Max, Paramount+, and PBS KIDS.
  BBC iPlayer selections run through the separately installed iPlayer Media
  and Extras Getter; HBO Max
  catalogue jobs preserve exact episode UUIDs from the public show catalogue
  through playback capture and pass the canonical public show link to each
  exact-file metadata handoff. Paramount+ delegates a whole movie or complete
  series to a locally configured external backend; Amazon Prime jobs preserve
  an exact per-episode playback identity and stabilize ad, trailer, manifest,
  and key activity before command creation; and
- Destination-aware media handoff and safe reuse of existing series folders,
  including year-qualified folder names, without guessing between ambiguous
  matches.

MediaFab was made *by* an everyday Jellyfin user who is also a software
developer and a hobby media archivist, *for* other Jellyfin users, archive
owners, people creating physical media, the person who simply wants to preserve
a comfort show, and everyone in between. It is the result of following one
practical question much farther than expected—and building the local workflow
that should be free.

## About MediaFab

MediaFab is a maintained fork of
[WidevineProxy2](https://github.com/DevLARLEY/WidevineProxy2). It retains the
upstream Widevine EME challenge and license workflow and adds a broader,
subtitle-aware media-command system.

It can recognize protected playback records and supported public media
requests, build an N_m3u8DL-RE command using the current request context, keep
user-selected downloader options authoritative, save full external subtitles,
clean recognized work folders after success, and optionally hand the completed
media to one of the user's local metadata tools.

The extension provides two related workflows:

- **Normal workflow** — capture and handle the media playing in the current tab,
  run an open BBC iPlayer episode through iPlayer Media and Extras Getter, or
  run the open Paramount+ show, movie, or episode through its configured local
  backend without playback capture.
- **Queue Mode** — select discovered episodes or enter playing-page links
  manually, then process them sequentially through a dedicated browser tab and
  MediaFab Companion.

Browser-capture jobs in both workflows use the same normal command builder.
Paramount+ uses the same structured external-backend job and settings model in
normal and Queue Mode instead of an N_m3u8DL-RE command. BBC iPlayer uses the
same MediaFab destination, picker, live queue, and Companion handoff while its
clear-stream download, subtitles, metadata, artwork, and organization remain
owned by iPlayer Media and Extras Getter.

MediaFab runs locally. It is not a hosted download service, does not download
media by itself, does not provide Widevine device files, and does not grant
access to any media. It prepares—and, when MediaFab Companion is enabled (not
provided here in this repo), dispatches—commands for separately installed
tools (also not provided here in this repo). Use MediaFab legally and only with
media you own or are explicitly authorized to access.

## What MediaFab Handles

| Layer | Current behavior |
| --- | --- |
| Protected media | Preserves the upstream Widevine challenge/license and content-key workflow. |
| Public media | Captures supported HLS, DASH, Smooth Streaming, and verified direct MP4 playback sources without requiring a content key. |
| Request context | Carries current headers, authorization, cookies, referer information, and keys into the generated command when available. |
| Media choices | Keeps container, video quality, audio, subtitles, Shaka Packager, logging, and additional N_m3u8DL-RE arguments under user control. |
| External subtitles | Detects subtitle files and subtitle-specific API/manifest data, preserves required headers, converts supported text formats to SRT, and uses Jellyfin-ready filenames. |
| Completion | Waits for video, subtitles, cleanup, and an enabled metadata handoff before considering a command complete. |
| Queue processing | Runs one episode at a time and does not open simultaneous download jobs. |
| Metadata | Optionally hands completed output to Media Metadata and Extras Getter or Live Performance Metadata and Extras Getter. |

## N_m3u8DL-RE

MediaFab captures the fresh playback information and turns it into a complete
command for [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE), which is the
separately installed tool that retrieves the selected video, audio, and
manifest-provided subtitle streams and muxes them using the chosen MediaFab
settings. MediaFab itself does not include N_m3u8DL-RE or download the media.

In the normal workflow, the command can be copied into Terminal or launched by
clicking its Run button when the optional Companion is configured. In Queue
Mode, the required Companion launches that same MediaFab-built command while it
is still fresh, waits for its complete media, subtitle, cleanup, and optional
metadata chain, and then allows the next episode capture to begin.

## Normal Single-Download Workflow

1. Open MediaFab and configure a Widevine Device or Remote CDM when protected
   playback requires one.
2. Enable capture, open a page you are authorized to use, and begin playback.
3. Expand the captured record under Media and Keys.
4. Set the N_m3u8DL-RE executable and Additional arguments you want.
5. Copy the complete command into Terminal, or configure Optional Companion
   and click Run beside that captured command.
6. If Metadata and Extras Getter is enabled, MediaFab runs the selected
   getter only after media, external subtitles, and cleanup succeed.

Protected records have a sparkle icon beside their URL and display their PSSH
and keys. Public records do not have the sparkle; they provide a no-key command
and show a detected runtime when the manifest supplies enough information.
Paramount+ is intentionally not handled through MediaFab's browser-capture
path. On an open Paramount+ show, movie, or episode page, the popup adds
Paramount+ Download Options and a Run button that hands the public URL to the
locally configured backend through the Companion.
On an open BBC iPlayer episode, the popup instead shows BBC iPlayer options and
a Run button for the separately installed iPlayer Media and Extras Getter. A
UK VPN connection must remain active while that getter accesses iPlayer.

## Queue Mode

The popup's **Queue** button opens the full **Queue Mode** page.

### Build the Queue

- **Load a Series from a Link Mode** supports season and episode
  discovery from a single supported series or episode link. Amazon Prime Video,
  BBC iPlayer, Crunchyroll, Disney+, HBO Max, Paramount+, and PBS KIDS are
  compatible with Queue Mode. A separate public detail link is not needed when using this mode.
- **Manual Queue Creation Mode** accepts any number of playing-page links for
  providers that do not yet have catalogue support. Every item has
  its own optional detail-link field. Keep items from the same series together;
  one item in that group can provide the detail link while the others remain
  blank because Media Metadata and Extras Getter can use one link for the
  series.
- Season, episode, and Select All controls determine which episodes are added
  before processing begins.
- **Live Queue** shows the current job, completed jobs, failures, and overall
  progress while the selected episodes are processed. Paramount+ appears as
  one complete-title job: a show job delegates all seasons and episodes to its
  configured backend.

### Process the Queue

1. Choose the destination.
2. Configure the visible media and subtitle settings. Paramount+ shows its
   backend-specific settings instead of N_m3u8DL-RE settings. BBC iPlayer shows
   its getter folder, BBC quality, and subtitle settings instead.
3. Optionally configure Media Metadata and Extras Getter or Live Performance
   Metadata and Extras Getter.
4. Enter the absolute MediaFab Companion folder path.
5. Use **Start selected**.

Queue Mode creates one new dedicated browser tab and never takes over an
existing user tab. It navigates that tab to one selected episode, waits for a
fresh complete capture, forms the same command used by the normal workflow,
dispatches it immediately, and waits for the command's real exit status before
advancing. External-backend jobs do not open that tab or wait for browser
playback; the Companion launches their structured local argv directly and
still waits for the real exit status before advancing.

BBC iPlayer jobs also skip browser capture. MediaFab passes each selected exact
`/iplayer/episode/<PID>` URL to iPlayer Media and Extras Getter, waits for that
episode's download, subtitles, metadata, artwork, and organization to finish,
and only then advances the live queue.

Terminal identifies each job as:

```text
Series Name — Episode: S01E07 — Episode Title
```

The concise display uses real segment percentages when the downloader exposes
them and an animated indeterminate bar while video activity is real but no
measurable percentage is available. Failed jobs remain visible, and **Cancel
current** stops the one active capture or download.

## MediaFab Companion

MediaFab Companion is a separate local application and is not included in this
repository. MediaFab does not download any media. If configured with the
Companion, it can pass commands to N_m3u8DL-RE. Queue Mode requires the
Companion because each short-lived command must be opened immediately and
monitored before the browser advances.
The normal single-download workflow does not require it; there, it only adds a
user-clicked Run button as an alternative to copying the command manually.

Registering the Companion for Firefox means installing a Native Messaging host
manifest that gives Firefox permission to connect MediaFab to that specific
local Companion launcher. The separately distributed Companion includes an
installer. From its own folder on macOS, registration is performed with:

```sh
python3 scripts/install_macos.py --firefox
```

That installer writes the Native Messaging registration under the current
macOS user's Firefox application-support folder and records the launcher's
absolute path. It does not install MediaFab, N_m3u8DL-RE, FFmpeg, or metadata
tools. After registration, enter the Companion's absolute folder path in
MediaFab. Re-run the installer after moving the Companion folder because the
saved launcher path must remain exact.

The Companion:

- validates the configured project folder and destination;
- checks the downloader and FFmpeg before a batch starts;
- rejects stale captures rather than launching expired jobs;
- opens a short private runner in Terminal instead of exposing the complete
  credential-bearing command at the prompt;
- tracks the real downloader exit status;
- pauses the queue when Terminal cannot prove that the first command started;
- keeps failed Terminal output visible;
- optionally closes the exact successful Terminal window it opened; and
- waits for each full normal command chain before allowing the next capture.

### Local External Backends

Paramount+ normal and Queue modes require an external backend configured only
on the local machine. MediaFab sends the Companion a backend identifier, the
public source URL, selected destination, and validated public media choices;
it never stores or sends a backend command, credential, private service
address, device file, or proxy setting.

The Companion reads `local-backends.json` from its own folder. That file is
gitignored and must have mode `600`, which means only the file's owner can read
or change it; other local accounts receive no access. Each backend is a
structured argv list, not a shell command. The supported placeholders are
`{source_url}`, `{destination}`, and `{media_options}`. The media-options
placeholder expands MediaFab's validated GUI choices into separate arguments;
place it where the backend expects its global download options, before a
service identifier when the command uses one. For example:

```json
{
  "backends": {
    "paramountplus": {
      "argv": [
        "/path/to/uv",
        "run",
        "--directory",
        "/path/to/unshackle",
        "--frozen",
        "unshackle",
        "dl",
        "{media_options}",
        "--output",
        "{destination}",
        "{source_url}"
      ]
    }
  }
}
```

Add any account, remote-service, device, region, or proxy options required by
your own authorized setup only to that local file or the backend's own local
configuration. The public integration is compatible with the public
[Unshackle](https://github.com/unshackle-dl/unshackle) command-line interface;
it does not include provider code or access to any third-party service.

MediaFab exposes the backend's applicable quality, range, codec, bitrate,
language, subtitle, wanted-episode, mux, naming, resume, and performance
choices in both GUIs. Connection and credential controls are intentionally not
GUI settings. MediaFab validates every GUI-generated argument against a fixed
allowlist before the Companion adds it to the structured argv.

Unshackle cover images are normally muxed into the MKV as attachments and its
temporary image files are cleaned afterward. That is embedded cover art, not a
separate poster or NFO set. When Media Metadata and Extras Getter is enabled, a
private local post-script runs synchronously after each Paramount+ file reaches
its final path. It passes Media Metadata and Extras Getter the exact final file
and the already loaded Paramount+ show, movie, or episode URL before the backend
advances. No separate detail link is required.

## Subtitles

MediaFab treats separately captured subtitle files as part of the completed
media job.

- Request headers are retained for authenticated, short-lived subtitle URLs.
- VTT and other supported text tracks are converted to SRT with FFmpeg.
- Sidecars use the completed video stem and a language suffix.
- Repeated captures and equivalent VTT/SRT representations are collapsed.
- A directly observed browser subtitle is preferred over an inferred duplicate.
- Queue Mode retains one best full track per language.
- Tiny signs, title-card, and forced-only tracks are not retained as the full
  subtitle when a real full-language track is available.
- Subtitle and work-folder cleanup occurs before the metadata handoff.

## Metadata and Extras

MediaFab can invoke one separately installed local tool after successful media
and subtitle completion:

- **Media Metadata and Extras Getter** for general supported media.
- **Live Performance Metadata and Extras Getter** for supported
  live-performance providers.

For every provider supported by Media Metadata and Extras Getter, the individual
workflow uses the current public provider page automatically, so its detail-link
field is only an optional override. Queue Mode retains the provider-appropriate
episode or series link for each selected item. Prime handoffs use the exact
episode `/detail/...` page when MediaFab has resolved it and otherwise pass the
current Prime page for Media Metadata and Extras Getter to resolve. Every
handoff passes the final existing media file only after download, correction or
remuxing, subtitle handling, and cleanup. Manual detail-link overrides remain
available when needed. Paramount+ uses the loaded public URL as its Media
Metadata and Extras Getter catalogue identity and hands over each exact
completed file.

Netflix support is metadata-only. Media Metadata and Extras Getter can use
supported public Netflix title data, but MediaFab does not currently provide a
working Netflix download or Queue Mode catalogue route.

BBC iPlayer follows a separate route: the required iPlayer Media and Extras
Getter performs the clear-stream download and its own metadata, artwork, and
organization. MediaFab does not run an additional Media Metadata and Extras
Getter handoff for those BBC jobs.

## Requirements and Compatibility

The complete current MediaFab workflow is developed and verified with:

- macOS Tahoe 26.5.2
- Firefox 152.0.6
- N_m3u8DL-RE available by name or configured executable path
- FFmpeg available to the subtitle workflow
- iPlayer Media and Extras Getter plus an active UK VPN connection for BBC
  iPlayer normal and Queue Mode jobs

The inherited core extension supports Firefox and Chrome on Windows and Linux,
but the fork's Terminal companion, external-subtitle command chain, and current
Queue Mode workflow are macOS-focused. Chrome native-host registration is
available for an unpacked extension ID, but MediaFab has not been tested on
Chrome.

A Widevine Device or compatible Remote CDM is required only for protected
workflows that need it. This project does not include either one, and does not
point in the direction of where to get them.

## Install MediaFab

### Firefox Temporary Installation

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on...**.
3. Choose this checkout's [manifest.json](manifest.json).

Temporary extensions are removed when Firefox exits.

### Chrome Development Installation

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project folder.

MediaFab has not been tested on Chrome. The Chrome instructions are included
for developers who want to test the unpacked extension themselves.

## Data and Safety Model

- MediaFab handles sensitive playback URLs, request headers, cookies, and
  content keys. Do not post generated commands or raw logs publicly.
- Captured records remain in extension storage until removed through the
  extension or the temporary installation is reset.
- MediaFab Companion uses private temporary command and transcript files and removes
  its per-job runtime directory after completion tracking.
- MediaFab does not bundle a CDM, N_m3u8DL-RE, FFmpeg, iPlayer Media and Extras
  Getter, Media Metadata and Extras Getter, or Live Performance Metadata and
  Extras Getter.
- Metadata handoffs use `--skip-existing` so matching metadata or artwork is
  not intentionally overwritten by the handoff command.
- Catalogue discovery is provider-specific rather than guessed from
  arbitrary sites.
- An ambiguous year-labeled series-folder match is left unresolved instead of
  routing media into an arbitrary folder.

Use MediaFab only with media you own or are explicitly authorized to access.
You are responsible for complying with applicable laws, service terms,
copyright, and access restrictions.

## Project Documentation

- [Changelog](CHANGELOG.md) — maintained fork history.
- [Original README](original-readme.md) — current fork additions above a divider
  and the preserved upstream README below it.

## License and Credits

MediaFab remains licensed under the [GNU General Public License v3.0](LICENSE).

The project is built on
[WidevineProxy2](https://github.com/DevLARLEY/WidevineProxy2) and retains its
upstream credits, including
[node-widevine](https://github.com/Frooastside/node-widevine),
[forge](https://github.com/digitalbazaar/forge), and
[protobuf.js](https://github.com/protobufjs/protobuf.js).
