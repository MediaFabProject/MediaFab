# Changelog

All notable changes to this fork are documented in this file.

This changelog documents changes made by the MediaFab project. For changes prior to the fork point, see the upstream project history.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Every user-visible change to this fork must add an entry under **Unreleased**
before it is committed.

## [Unreleased]

### Added

- Add HBO Max to the optional metadata-provider badge and Queue Mode catalogue
  discovery. Public `/show/<UUID>` links now populate the normal season and
  episode picker, and each job retains its exact episode UUID player link.
  Keep that authenticated player link for capture and filename identity while
  passing the canonical public show link to each exact-file Media Metadata and
  Extras Getter handoff.
- Add BBC iPlayer normal and Queue Mode through the separately installed
  iPlayer Media and Extras Getter. MediaFab provides the normal season and
  episode picker, BBC quality and subtitle settings, exact per-episode PID
  links, sequential Companion dispatch, and the selected destination while the
  getter owns clear-stream downloading, subtitles, metadata, artwork, and
  organization. A UK VPN connection is required for BBC access.
- Route BBC iPlayer episode pages exclusively through iPlayer Media and Extras
  Getter in the normal workflow. Do not display an intercepted BBC manifest as
  a separate N_m3u8DL-RE command, and preflight the getter route before opening
  its Terminal job.
- Make the individual-workflow detail-link field an optional override. Use the
  current public page automatically when no override is supplied.
- Restore Media Metadata and Extras Getter to every individual command chain.
  Each handoff now receives the exact completed video file and the current
  item's provider page after subtitles, naming, and cleanup, and Queue Mode
  waits for that handoff before advancing.

- Add a compact **Queue** entry point beside the popup theme control and a
  dedicated **Queue Mode** extension tab with visible catalogue, output, media,
  subtitle, metadata/extras, processing, and live-queue controls.
- Add a provider-adapter boundary and job model for one-page-at-a-time capture,
  immediate companion dispatch, and sequential download completion before the
  active browser tab advances to the next selected episode.
- Add Crunchyroll as the first Queue Mode provider with catalogue discovery,
  using the same
  anonymous public catalogue and version-selection rules as Media Metadata and Extras Getter for series,
  seasons, episodes, and canonical watch links.
- Add Disney+ Queue Mode catalogue discovery from public series or
  `/play/...` pages, including complete public seasons, episode positions,
  synopses, thumbnails, and canonical episode playback links.
- Add PBS KIDS Queue Mode catalogue discovery from series,
  full-episode playlist, or episode watch pages, including current numbered
  episodes, canonical watch links, playback activation, existing-episode
  skipping, and exact-file Media Metadata and Extras Getter handoffs.
- Add Amazon Prime Video Queue Mode catalogue discovery with a
  separate GTI, compact GTI, ASIN set, playback ID, and exact episode detail
  link for every queued episode. Carry that verified identity into capture
  ownership so Prime's natively loaded manifest can produce a Queue command
  without depending on the page fetch hook. Prime metadata handoffs bind
  protected playback to that episode identity and pass the final completed
  media file.
- Add Paramount+ normal and Queue Mode through one structured external-backend
  handoff. The popup can run the open show, movie, or episode URL without
  playback capture; Queue Mode can submit a whole movie or complete series.
  Movie links become one complete-movie job and show links become one
  all-seasons-and-episodes job without depending on browser playback capture.
  Keep the backend argv and every private setting in an owner-only, gitignored
  Companion configuration file.
- Use Paramount+'s title-specific public catalogue poster in the Queue Mode
  series overview, with title artwork or an episode image as the fallback
  instead of the generic Paramount+ sharing image.
- Add shared Paramount+ GUI controls for applicable quality, dynamic range,
  codecs, bitrates, languages, subtitles, episode ranges, mux behavior, naming,
  resume, and performance options. Hide N_m3u8DL-RE controls for Paramount+
  and reject private connection/CDM/proxy flags at the Companion boundary.
- Add synchronous per-file Paramount+ Media Metadata and Extras Getter handoff after the backend creates
  each final file. Reuse the loaded Paramount+ URL, pass the exact final media
  path, require no separate detail link, and wait for Media Metadata and Extras Getter before continuing.
- Give Amazon Prime Queue captures a ten-second quiet window so episode
  manifests and keys can replace ad or trailer activity, and automatically
  retry the same episode instead of asking for an unusable manual Play action.
- Show the identified Amazon Prime series, episode position, and episode title
  in individual-mode Terminal headers instead of the provider hostname.
- Hand Disney+ episode jobs to Media Metadata and Extras Getter using the exact newly completed media file,
  and honor English-only subtitle selection for separately captured Disney+
  subtitle playlists in both normal and Queue Mode workflows.
- Auto-use a captured Crunchyroll watch-page URL for the Media Metadata and Extras Getter handoff, matching
  the existing BroadwayHD-to-Live Performance Metadata and Extras Getter convenience. A current watch page overrides
  a stale saved Crunchyroll series link, while other providers retain manual
  detail-link behavior.
- Give automatic Crunchyroll handoffs a neutral temporary watch-ID save name,
  track the exact video completed by that command, and hand that file to Media Metadata and Extras Getter so
  timestamp digits cannot be misread as an episode position.
- Create and reuse one dedicated browser tab for sequential provider capture,
  leaving every pre-existing user tab untouched.
- Reuse one unambiguous existing Media Metadata and Extras Getter series folder while ignoring a trailing
  `(year)`, `(year-year)`, or `(year-)` label; never guess between ambiguous
  same-title year variants.
- Add a Queue Mode option to close only the exact successful Terminal windows
  opened by the companion while leaving failed jobs visible.
- Add native-companion messaging support while keeping the separately packaged
  companion development project ignored by this extension repository.
- Add an unlimited manual episode-link alternative with visible add and delete
  controls so providers without catalogue adapters can still use the
  sequential queue. Give every manual item its own optional metadata detail
  link, and let contiguous items from the same series share the one supplied
  link while their remaining fields stay blank.
- Capture public HLS, DASH, and Smooth Streaming manifest requests, including
  native media-player playlist traffic, and show a no-key download command in
  the same captured-media workflow.
- Capture direct public `.mp4` video-element sources without treating fMP4
  stream segments as standalone files.
- Report the detected runtime of public HLS, DASH, and Smooth Streaming media
  beside its generated command when the manifest provides enough information.
- Capture external subtitle files from browser traffic, including direct file
  requests and subtitle-specific API or manifest data.
- Preserve captured subtitle request headers with each URL so generated
  follow-up download commands can make the same authenticated request.
- Generate follow-up `curl` and `ffmpeg` commands for captured subtitles,
  converting temporary VTT downloads to SRT sidecars in the video output
  directory.
- Infer subtitle language from HLS, DASH, and structured API metadata, with
  URL-based language detection as a fallback.
- Name subtitle sidecars by language (`en.srt`, `fr.srt`); use `und.srt` for
  unknown languages and a numeric suffix for duplicate languages.
- Remove recognized N_m3u8DL-RE `master-<UUID>_<timestamp>` work directories
  after the video and every subtitle sidecar complete successfully.
- Refresh already displayed generated commands when the Additional arguments
  setting changes.
- Print MediaFab subtitle-status notes after N_m3u8DL-RE completes, including a
  terminal spinner while separately captured subtitle files are downloaded,
  plus a final success message after cleanup.
- Document macOS Tahoe 26.5.2 with Firefox 152.0.6 as this fork's verified
  macOS development and test environment.
- Add a compact Metadata and Extras Getter card directly below Command options,
  with a one-choice dropdown for Live Performance Metadata and Extras Getter or Media Metadata and Extras Getter, separate saved setup for each,
  and the same safe handoff arguments.
- Refresh the popup with a modern light/dark layout and a unified
  media/metadata toolbar and popup icon set.
- Add locally remembered Hide/Show controls for popup settings, device, command,
  and metadata-getter cards, reducing scrolling without changing captured-key behavior.
- Rename captured subtitle sidecars to Jellyfin's video-stem-plus-language
  convention (for example, `Once.en_us.srt`) and preserve that association when
  the optional Live Performance Metadata and Extras Getter handoff renames a generic downloader video.
- Auto-use a captured BroadwayHD detail-page URL for the Live Performance Metadata and Extras Getter handoff when it
  matches `broadwayhd.com/video/<id>`, while retaining manual links for every
  other provider.

### Changed

- Use upstream-style message-property interception only on Amazon Prime Video,
  allowing Amazon's original trusted license event to reach its player while
  MediaFab substitutes the re-signed challenge. All other sites retain the
  existing replacement-event interception path.
- Remove the abandoned Paramount+ browser interception, ad-wrapper inspection,
  and programme-track selection experiment now that Paramount+ uses
  the separately configured backend route.
- Give MediaFab its own stable `mediafab@mediafab` Firefox extension identity
  and use the same ID in the separately distributed Companion's Native
  Messaging registration.
- Rebuild the public README with a plain-language N_m3u8DL-RE workflow,
  Companion registration and safety boundaries, clearer Queue progress and
  automatic detail-link behavior, temporary Firefox installation guidance,
  explicit untested Chrome status, and no internal provider or Companion
  development guides.
- Port upstream's v1.2 interception improvements without adopting its build
  pipeline: re-sign each browser-originated Widevine request, handle OEMCrypto
  and service certificates correctly, suppress replaced EME events reliably,
  refresh cached captures through a new request, correct ClearKey identity,
  broaden manifest inspection, and register page hooks only while enabled.
- Make normal-workflow Companion launches explicitly user initiated: the
  background never auto-dispatches captured commands, and a compact Run
  button appears beside each command only while Optional Companion is enabled,
  connected, and fully configured. Queue Mode remains sequential.
- Recolor the existing MediaFab logo, browser toolbar icons, README badges,
  popup, and Queue Mode light/dark themes with the shared green-and-lavender
  project palette while preserving the established icon design.
- Reuse one shared normal-download command builder for both the popup and Queue
  Mode. Queue controls generate the downloader option string, while the shared
  builder remains responsible for current headers, keys, subtitles, cleanup,
  metadata handoff, and completion gating.
- Align Crunchyroll Queue Mode with Media Metadata and Extras Getter's finalized normal-download workflow:
  download directly into the user-selected folder, hand off the exact completed
  episode file, and let Media Metadata and Extras Getter reuse or create the correct series and season
  structure after external subtitle work finishes.
- Launch each Queue Mode job through a short private temporary script and a
  pseudo-terminal transcript, keeping the generated command and captured
  credentials off the visible Terminal prompt. Present only BBC/Marquee-style
  phase progress, subtitle/metadata status, completion, and useful failures
  while retaining raw output privately for Queue Mode failure tracking.
- Prefer directly captured subtitle files over a duplicate manifest subtitle,
  merge repeated captures by content, retain only the highest-cue full track
  per language, and discard signs/forced-only tracks before the metadata
  handoff.
- Use the normal command builder's subtitle selection and Jellyfin sidecar
  naming in every Queue Mode job.
- Mark protected captured streams with a compact sparkle beside their URL.
- Include captured subtitle metadata with each selectable manifest so command
  generation can handle subtitle URLs found outside the manifest itself.
- Keep the user's Additional arguments as the authoritative N_m3u8DL-RE
  selection and muxing configuration.
- Reuse the originating response headers when a subtitle URL is found inside
  an API response rather than requested directly by the page.
- Normalize three-letter language codes such as `eng-GB` to standard sidecar
  tags such as `en-gb`, and inspect additional API language-code and label
  fields before falling back to the subtitle URL.
- Run external `ffmpeg` subtitle conversion quietly, retaining error output
  while removing its banner, stream map, and progress noise after the main
  downloader reports completion.
- Prefer a directly observed browser request when VTT and SRT format variants
  describe the same subtitle asset; download a selected SRT directly and
  convert other supported subtitle formats to SRT.
- Clarify that the core extension remains cross-platform while this fork's
  external-subtitle workflow is currently supported on macOS only.
- Keep Live Performance Metadata and Extras Getter entirely standalone by making its integration an explicit,
  post-success generated-command handoff only.
- Clarify generated macOS command progress with subtitle completion and
  metadata/extras start messages, and use the same MediaFab note prefix for the
  handoff result.

### Fixed

- Allow a user-clicked individual-mode Companion launch for up to five minutes
  after capture while requiring the explicit MediaFab Run action. Queue Mode
  keeps its stricter five-second automatic-capture requirement.
- Capture Max DASH manifests issued through native or service-worker media
  requests, associating an otherwise tabless `h264.io` manifest only when one
  Max tab is an unambiguous owner. Intercept Max players that register their
  Widevine callback through `MediaKeySession.onmessage` while retaining the
  existing replacement-event mode and leaving Amazon-only property mode
  unchanged. Treat those Max DASH manifests as protected immediately so a
  delayed or cached license event cannot publish a false no-DRM command that
  downloads encrypted, scrambled tracks.
- Inspect Max multi-period DASH manifests and bind captured keys to the longest
  protected programme period. Generated commands now exclude the clear ad
  periods, choose the best programme video tier for which a key was actually
  captured, and select Max's normal audio representation instead of its
  alternate descriptive-audio track. Pair a captured playback by its programme
  video key rather than requiring Max's manifest and license PSSH bytes to be
  identical, and prefer the newest signed manifest when Max refreshes the same
  asset. Refuse a command when programme video keys and the protected period
  cannot be paired.
- Escape dollar signs in generated downloader URLs so Amazon's signed MPD path
  segments reach N_m3u8DL-RE literally instead of being expanded by zsh and
  rejected by the CDN with `403 Forbidden`.
- Replace Queue Mode's static video preparation message with an immediately
  visible animated progress bar, retaining real percentage progress whenever
  N_m3u8DL-RE exposes it without displaying raw segment counts.
- Keep long finalization and metadata stages visibly active in MediaFab
  Companion so a completed download percentage does not look like a stalled
  job while muxing or metadata work continues.
- Require a protected capture's PSSH to match the selected manifest whenever
  manifests expose that identity, preventing stale Crunchyroll manifests from
  being combined with keys from another playback.
- Select Disney+'s complete HLS master playlist instead of a video-only child
  rendition, and replace the original capture card when the master arrives
  after the protected key event.
- Retain HBO Max's canonical public show or movie identity from page and API
  data so an authenticated `/video/watch/...` download can complete its
  exact-file metadata handoff without a manual detail-link override.
- Ignore BBC iPlayer season and navigation containers while building its Queue
  Mode episode catalogue, preventing structural season records from appearing
  as an extra season of episodes.
- Hold Crunchyroll `/cenc/` manifests on the protected capture path, refresh
  retried request headers, require usable content keys plus Authorization,
  Cookie, and Referer before launch, and use the exact watch page as Referer
  when Firefox omits it from the captured manifest request.
- Launch Queue Mode downloader jobs as visible, safely quoted Terminal commands
  instead of asking Python to execute the unsigned downloader directly, while
  retaining completion, failure, sequential-queue, subtitle, and Media Metadata and Extras Getter tracking.
- Pause the entire Queue Mode queue when the first Terminal job does not prove
  that it started, preventing one macOS security failure from spawning prompts
  for the remaining selected episodes.
- Refuse Queue Mode preflight before any capture or launch when the resolved
  downloader still has a macOS quarantine attribute, and report the exact
  one-time approval command instead of triggering repeated Gatekeeper dialogs.
- Replace Queue Mode's Tkinter destination picker with the native macOS folder
  chooser so selecting a folder does not leave a frozen Python window.
- Keep a Queue job's tracking files available from Terminal startup through its
  final exit status, so a large generated command cannot outlive a startup
  timeout and strand the remaining queue.
- Do not mistake media chunks beneath a Smooth Streaming `.ism` path for
  manifests; public capture now ignores those `.ts` segments.
- Prefer a captured public HLS master playlist over its child playlists and do
  not invoke Shaka Packager for public streams.
- When JW Player exposes only same-media child playlists, retain the
  highest-bitrate one and omit an incompatible resolution-based video selector.
- Recover JW Player's public master playlist from an observed child playlist so
  the user's requested resolution can select the closest available rendition.
- Remove the generated `master-<name>_<timestamp>` work folder after success,
  not only folders whose name begins with a UUID.
- Remove N_m3u8DL-RE's newer `manifest-<name>_<timestamp>` raw-playlist work
  folders after a successful command as well.
- Prevent stale generated commands from being copied after command options are
  edited.
- Exclude JW Player's thumbnail-image VTT index and collapse text-identical
  subtitle responses to one sidecar download.
- Deduplicate externally captured subtitle URLs before follow-up commands are
  generated.
- Avoid treating a subtitle-list API endpoint as a downloadable subtitle file
  when the response contains the actual subtitle URLs.
- Limit generated external downloads to known subtitle-file extensions in
  direct requests or subtitle-specific API/manifest fields.
- Prevent stale or duplicate external subtitle links from producing additional
  sidecars, stalled commands, or inaccurate subtitle counts.
- Prevent Live Performance Metadata and Extras Getter local configuration or removed log entries from being treated
  as newly captured key records in the popup.
- Restore the captured-key collapsed view so it shows only the URL until its
  `+` control is opened, without malformed partial input rows.
- Align expanded captured-key labels and their inputs/selects into consistent
  two-column rows for clearer scanning and copying.

## [0.9.1] - 2026-07-15

### Fork baseline

- Fork baseline: `MediaFabProject/MediaFab` `main` at
  `801a7488f8c13f4847ed05ec701f150008976e8a`.
- This fork remains licensed under the GNU General Public License, version 3.0.
  The upstream `LICENSE` file is retained verbatim.

[Unreleased]: https://github.com/MediaFabProject/MediaFab/compare/801a7488f8c13f4847ed05ec701f150008976e8a...HEAD
[0.9.1]: https://github.com/MediaFabProject/MediaFab/tree/801a7488f8c13f4847ed05ec701f150008976e8a
