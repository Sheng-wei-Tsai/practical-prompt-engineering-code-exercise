# Prompt Library

A lightweight, dependency-free Prompt Library web app that runs fully in the browser.
You can create prompts, rate them, attach notes, track metadata, review activity history, and import/export your prompt data.

All data is stored locally using `localStorage`.

## Project Context

This repository started from the Frontend Masters workshop **Practical Prompt Engineering** and has been extended with additional product features (history, metadata visualization, improved import/export, model picker UX, and prompt-level notes workflow).

## Features

- Add prompts with title, model, and full prompt content
- Model picker with popular current models + custom model entry
- Prompt metadata tracking:
	- model
	- created/updated timestamps
	- token estimate + confidence level (high/medium/low)
- Card-level rating (5-star, locally persisted)
- Prompt notes (add/edit/delete) with confirmation on delete
- Dedicated History tab with newest-to-oldest activity timeline
- Delete confirmation for prompts
- Local persistence via `localStorage`
- Export/import with versioned JSON schema, validation, merge/replace options, backup, and rollback

## Tech Stack

- Plain HTML
- Plain CSS
- Vanilla JavaScript
- No framework
- No build step
- No runtime dependencies

## Run Locally (Step by Step)

1. Clone this repository.
2. Open the project folder in VS Code.
3. Open `index.html` directly in your browser, or use Live Server.
4. Start adding prompts from the left panel.

## App Workflow (Step by Step)

1. Add Prompt
	 - Enter title
	 - Choose model from dropdown or select `Other (type your own)`
	 - Enter content and save
2. Review Saved Tab
	 - Scroll full content in fixed-size content box
	 - Review metadata and ratings
	 - Add/edit/delete notes
3. Review History Tab
	 - See save/delete/import events in newest-to-oldest order
	 - Clear history if needed
4. Export/Import
	 - Use top-right buttons (`Export`, `Import`)

## File Overview

| File | Purpose |
|---|---|
| `index.html` | App structure, prompt form, tab panels, prompt card template |
| `styles.css` | UI layout, cards, tabs, history timeline, notes styling |
| `script.js` | Prompt CRUD, metadata, notes, history, export/import logic |

## Data Storage Keys

- `promptLibrary.items.v1`: prompt records
- `promptNotes.v1`: notes map by prompt ID
- `promptHistory.v1`: activity timeline entries
- `promptLibrary.items.v1.backup`: temporary backup used during import rollback

## Prompt Data Format

Each prompt is stored in `promptLibrary.items.v1`.

```json
{
	"id": "p_ab12cd34",
	"title": "Weekly Newsletter Generator",
	"content": "You are an expert editor...",
	"metadata": {
		"model": "gpt-4.1",
		"createdAt": "2026-03-14T10:20:30.456Z",
		"updatedAt": "2026-03-14T10:20:30.456Z",
		"tokenEstimate": {
			"min": 42.75,
			"max": 128.5,
			"confidence": "high"
		}
	},
	"userRating": 4
}
```

## Notes Data Format

Notes are stored separately in `promptNotes.v1` as a map keyed by prompt ID.

```json
{
	"p_ab12cd34": [
		{
			"id": "note_mz9d8_4f2a",
			"content": "Adjust tone for product updates.",
			"createdAt": 1710417000000,
			"updatedAt": 1710417000000
		}
	]
}
```

## History Data Format

History is stored in `promptHistory.v1`.

```json
[
	{
		"id": "h_abc123xyz",
		"action": "save",
		"promptId": "p_ab12cd34",
		"title": "Weekly Newsletter Generator",
		"model": "gpt-4.1",
		"at": "2026-03-14T10:20:30.456Z",
		"details": ""
	}
]
```

## Export / Import (Step by Step)

### Step 1: Export

Click `Export` to download a versioned JSON file containing prompt data and computed statistics.

### Step 2: Import Validation

On import, the app validates:

1. JSON parseability
2. Root/object shape and supported version
3. Prompt array presence
4. Prompt record shape and metadata integrity
5. Duplicate IDs inside the imported file

### Step 3: Conflict Handling

During import, the app asks you:

1. Replace all existing prompts, or merge with existing prompts
2. If merging and duplicates exist:
	 - overwrite duplicate IDs with imported records, or
	 - keep existing local duplicates

### Step 4: Recovery Safety

Before import write, existing prompts are backed up.
If any step fails, prompts are rolled back and an error message is shown.

## Export JSON Schema (Current)

```json
{
	"type": "prompt-library-export",
	"version": 2,
	"exportedAt": "2026-03-14T10:20:30.456Z",
	"stats": {
		"totalPrompts": 12,
		"averageRating": 4.25,
		"mostUsedModel": "gpt-4.1"
	},
	"prompts": [
		{
			"id": "p_ab12cd34",
			"title": "...",
			"content": "...",
			"metadata": {
				"model": "...",
				"createdAt": "...",
				"updatedAt": "...",
				"tokenEstimate": {
					"min": 0,
					"max": 0,
					"confidence": "high"
				}
			},
			"userRating": 0
		}
	]
}
```

## Notes

- Data is local-first. Clearing browser storage removes local data.
- History is rendered newest to oldest.
- Export/import currently targets prompts. Notes remain in local storage and are not included in the current export payload.

## Future Ideas

- Search and filter by model/rating/date
- Tagging system for prompts
- Prompt pinning and sorting controls
- Dedicated custom modal for import conflict choices
- Include notes and history in next export schema version

---

Built on top of coursework from Frontend Masters: Practical Prompt Engineering.