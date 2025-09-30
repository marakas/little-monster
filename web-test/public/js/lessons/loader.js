// public/js/lessons/loader.js

export function normalizeApiLesson(api) {
  const lessonMeta = api?.lesson ?? {};
  const units = Array.isArray(api?.units) ? api.units : [];

  const byType = (t) => units.find((u) => String(u?.type).toLowerCase() === t);

  const vocabU = byType("vocab");
  const speakingU = byType("speaking");
  const convoU = byType("conversation");

  const norm = {
    lesson: {
      level: lessonMeta.level ?? "",
      focus: lessonMeta.focus ?? "",
      notes: (lessonMeta.notes ?? "").trim(),
    },
    units: [],
  };

  if (vocabU) {
    const items = (vocabU.items || []).map((it) => ({
      jp: it?.jp ?? "",
      en: it?.en ?? "",
      example_jp: it?.example_jp ?? "",
    }));
    norm.units.push({ type: "vocab", items });
  }

  if (speakingU) {
    const items = (speakingU.items || []).map((it) => ({
      jp: it?.jp ?? "",
      en: it?.en ?? "",
    }));
    norm.units.push({ type: "speaking", items });
  }

  if (convoU) {
    const turnsSrc = Array.isArray(convoU.turns) ? convoU.turns.slice() : [];
    turnsSrc.sort((a, b) => {
      const ai = Number.isFinite(a?.order_index) ? a.order_index : 0;
      const bi = Number.isFinite(b?.order_index) ? b.order_index : 0;
      return ai - bi;
    });
    const turns = turnsSrc.map((t) => ({
      speaker: t?.speaker ?? "",
      jp: t?.jp ?? "",
    }));
    norm.units.push({ type: "conversation", turns });
  }

  return norm;
}

/**
 * Fetch via local proxy by default (no token in browser).
 * If a full URL is provided, we still allow direct fetch (no auth added).
 */
export async function fetchLessonById(lessonIdOrUrl) {
  const url = /^https?:/i.test(lessonIdOrUrl)
    ? lessonIdOrUrl
    : `/lessons/${encodeURIComponent(lessonIdOrUrl)}`;

  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`API fetch failed (${r.status}): ${body}`);
  }
  const apiJson = await r.json();
  return normalizeApiLesson(apiJson);
}
