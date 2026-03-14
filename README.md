# Prompt Library

A lightweight, dependency-free prompt journal that runs fully in the browser.
You can save prompts, rate them, attach notes, review activity history, search across your library, and import or export the full local dataset.

All data is stored locally with `localStorage`.

## Features

- Add prompts with title, model, and full content
- Pick a common model or enter a custom model name
- Review prompt metadata: model, timestamps, and token estimate
- Rate prompts with a locally stored 5-star control
- Add, edit, and delete notes per prompt
- Search across titles, content, models, and notes
- Filter the saved library by model before rendering the final list
- Review save, delete, and import activity in a dedicated history tab
- Export prompts, notes, and history in a versioned JSON file
- Import with validation, rollback safety, and an explicit modal for replace or merge decisions
- Keep everything local-first with no backend dependency

## Tech Stack

- Plain HTML
- Plain CSS
- Vanilla JavaScript
- No framework
- No build step
- No runtime dependencies

## Run Locally

1. Clone this repository.
2. Open the folder in VS Code.
3. Open `index.html` in a browser, or use Live Server.
4. Start adding prompts from the left panel.

## App Workflow

1. Add a prompt with title, model, and content.
2. Review saved prompts in the library panel.
3. Use search and model filters to narrow the rendered list.
4. Add ratings and notes directly from each prompt card.
5. Switch to the history tab to review activity.
6. Export or import the full dataset from the header controls.

## Data Storage Keys

- `promptLibrary.items.v1`: prompts
- `promptNotes.v1`: notes keyed by prompt id
- `promptHistory.v1`: history timeline entries
- `*.backup`: temporary backup records used during import rollback

## Export Schema

Current export version: `3`

```json
{
  "type": "prompt-library-export",
  "version": 3,
  "exportedAt": "2026-03-14T10:20:30.456Z",
  "stats": {
    "totalPrompts": 12,
    "totalNotes": 19,
    "totalHistoryEvents": 34,
    "averageRating": 4.25,
    "mostUsedModel": "gpt-4.1"
  },
  "prompts": [
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
  ],
  "notes": {
    "p_ab12cd34": [
      {
        "id": "note_mz9d8_4f2a",
        "content": "Adjust tone for product updates.",
        "createdAt": 1710417000000,
        "updatedAt": 1710417000000
      }
    ]
  },
  "history": [
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
}
```

## Import Rules

On import, the app validates:

1. The file is JSON and under the configured size limit.
2. The payload includes a supported export version.
3. Prompt records are valid and prompt IDs are unique.
4. Imported prompt count stays within the configured limit.
5. Imported notes and history records are sanitized before persistence.

If import fails after backup, prompts, notes, and history are rolled back together.

## Notes

- The app is local-first. Clearing browser storage removes local data.
- Search and filtering happen before card rendering so larger libraries stay predictable.
- Import decisions for replace versus merge use an explicit modal instead of browser confirm dialogs.

---

Built on top of coursework from Frontend Masters: Practical Prompt Engineering.
