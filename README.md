
# LLM Batch Evaluator (Vite + React + TS)

A minimal project that loads a CSV, templates a prompt per row, calls OpenAI chat completions, and parses the model output as JSON. 
It mirrors the canvas app you were debugging, but with simple UI shims so you can run it locally in Cursor or VS Code.

## Quickstart
```bash
npm install
npm run dev
# open http://localhost:5173
```

## Notes
- The UI components under `src/components/ui/` are tiny shims to satisfy imports. Replace with your own design system if you like.
- This runs **directly in the browser** and calls the OpenAI API; for production use, proxy through a secure backend.
- Paste your API key in the UI before running.
- Model output is parsed as JSON and summarized to: `eval.valid`, `eval.score`, `eval.decision`, plus `evaluation_json`.
- Export results as CSV or JSON.

## Troubleshooting
- If you get CORS or 401, it’s an API or network issue — not a React rendering bug.
- If React throws an error like #321, ensure that all CSV headers and cells are strings and that the "Submission text column" is set.
