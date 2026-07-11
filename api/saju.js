const MODEL = 'gpt-5.4-mini';

const SYSTEM_PROMPT = `너는 한국 전통 사주(四柱) 분석가야. 사용자가 알려주는 생년월일과 태어난 시간을 바탕으로 사주를 해석해줘.
태어난 시간을 모르는 경우, 시간 기둥은 생략하고 나머지 정보로 해석해.
해석을 바탕으로 로또 번호 6개(1~45, 서로 중복 없이)와 보너스 번호 1개(나머지 중 하나, 앞의 6개와 겹치지 않음)를 추천해.

반드시 아래 JSON 형식으로만 응답해. 다른 텍스트, 설명, 코드 블록 표시는 절대 포함하지 마.
{"analysis": "사주 분석 요약 (한국어, 3~4문장)", "numbers": [n1, n2, n3, n4, n5, n6], "bonus": n7}`;

function buildFallback(reason) {
  const pool = Array.from({ length: 45 }, (_, i) => i + 1);
  const picked = [];
  for (let i = 0; i < 7; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  const bonus = picked.pop();
  return {
    analysis: reason,
    numbers: picked.sort((a, b) => a - b),
    bonus
  };
}

function sanitizeNumbers(rawNumbers, rawBonus) {
  const clean = Array.isArray(rawNumbers)
    ? [...new Set(rawNumbers.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 45))]
    : [];

  const pool = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => !clean.includes(n));
  while (clean.length < 6 && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    clean.push(pool.splice(idx, 1)[0]);
  }
  const numbers = clean.slice(0, 6).sort((a, b) => a - b);

  let bonus = Number(rawBonus);
  if (!Number.isInteger(bonus) || bonus < 1 || bonus > 45 || numbers.includes(bonus)) {
    const bonusPool = Array.from({ length: 45 }, (_, i) => i + 1).filter(n => !numbers.includes(n));
    bonus = bonusPool[Math.floor(Math.random() * bonusPool.length)];
  }

  return { numbers, bonus };
}

async function getSajuResult(birthDate, birthTime) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallback('서버에 API 키가 설정되지 않아 무작위로 번호를 뽑았습니다.');
  }

  const userMessage = birthTime
    ? `생년월일: ${birthDate}\n태어난 시간: ${birthTime}`
    : `생년월일: ${birthDate}\n태어난 시간: 모름`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.9,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      return buildFallback('사주 분석 서비스에 일시적으로 연결할 수 없어 무작위로 번호를 뽑았습니다.');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return buildFallback('사주 분석 결과를 해석하지 못해 무작위로 번호를 뽑았습니다.');
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return buildFallback('사주 분석 결과를 해석하지 못해 무작위로 번호를 뽑았습니다.');
    }

    const { numbers, bonus } = sanitizeNumbers(parsed.numbers, parsed.bonus);
    const analysis = typeof parsed.analysis === 'string' && parsed.analysis.trim()
      ? parsed.analysis.trim()
      : '사주 분석 결과를 바탕으로 번호를 추천했습니다.';

    return { analysis, numbers, bonus };
  } catch {
    return buildFallback('사주 분석 중 오류가 발생해 무작위로 번호를 뽑았습니다.');
  }
}

function sanitizeGender(rawGender) {
  return rawGender === 'male' || rawGender === 'female' ? rawGender : null;
}

async function saveToSupabase({ birthDate, birthTime, gender, analysis, numbers, bonus }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/saju_draws`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify([{
        birth_date: birthDate,
        birth_time: birthTime,
        gender,
        analysis,
        numbers,
        bonus
      }])
    });
  } catch {
    // Best-effort logging; a failed save should never block the user's result.
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { birthDate, birthTime, gender } = req.body || {};

  if (!birthDate || typeof birthDate !== 'string') {
    res.status(400).json({ error: 'birthDate is required' });
    return;
  }

  const cleanBirthTime = typeof birthTime === 'string' && birthTime ? birthTime : null;
  const cleanGender = sanitizeGender(gender);

  const result = await getSajuResult(birthDate, cleanBirthTime);

  await saveToSupabase({
    birthDate,
    birthTime: cleanBirthTime,
    gender: cleanGender,
    analysis: result.analysis,
    numbers: result.numbers,
    bonus: result.bonus
  });

  res.status(200).json(result);
};
