"""Metrics for evals."""

import os

metrics = []

PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")

for file in os.listdir(PROMPTS_DIR):
    if file.endswith(".md"):
        # Explicit utf-8: the default platform codec (GBK on Windows) cannot
        # decode non-ASCII characters in the metric prompts.
        with open(os.path.join(PROMPTS_DIR, file), "r", encoding="utf-8") as f:
            prompt = f.read()
        metrics.append({"name": file.replace(".md", ""), "prompt": prompt})
