import type { Task } from "@/lib/tasks/types";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "at", "by", "from", "is", "be",
  "we", "it", "this", "that", "need", "needs", "should", "add", "fix", "make", "update", "task",
]);

export function keywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
    ),
  ];
}

export interface SearchHit {
  task: Task;
  score: number;
  matched: string[];
}

/**
 * Keyword-overlap search over titles (weighted x2) and descriptions.
 * Deliberately simple: the board is small, and the agent judges relevance itself —
 * search only has to surface candidates.
 */
export function searchTasks(tasks: Task[], query: string, limit = 5): SearchHit[] {
  const terms = keywords(query);
  if (terms.length === 0) return [];

  return tasks
    .map((task) => {
      const title = keywords(task.title);
      const body = keywords(task.description);
      const matched = terms.filter((term) => title.some((w) => w.startsWith(term) || term.startsWith(w)) || body.includes(term));
      const score = matched.reduce((sum, term) => sum + (title.some((w) => w.startsWith(term) || term.startsWith(w)) ? 2 : 1), 0);
      return { task, score, matched };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.task.id - a.task.id)
    .slice(0, limit);
}
