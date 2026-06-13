const DAILY_LIMIT = 3;

// In-memory store: { "ip:date": count }
// Resets on each cold start, but sufficient for hobby-tier rate limiting
const usageMap = {};

function getToday() {
  return new Date().toISOString().slice(0, 10); // "2026-06-12"
}

function getUsageKey(ip) {
  return `${ip}:${getToday()}`;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  // Get client IP
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown';

  const key = getUsageKey(ip);
  const count = usageMap[key] || 0;

  if (count >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'limit_exceeded',
      message: `每个IP每天最多免费使用 ${DAILY_LIMIT} 次，您今日的免费次数已用完。`,
    });
  }

  const { propName, location, floorPlan, price, sp1, sp2, sp3 } = req.body || {};

  if (!propName || !location || !floorPlan || !price || !sp1 || !sp2 || !sp3) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const prompt = `你是一位顶尖的房产营销文案专家，精通抖音、小红书、微信视频号三大平台的短视频脚本创作。

房源信息：
- 房源名称：${propName}
- 地段：${location}
- 户型：${floorPlan}
- 价格：${price}
- 核心卖点1：${sp1}
- 核心卖点2：${sp2}
- 核心卖点3：${sp3}

请为以上房源生成三个平台的短视频口播脚本，按以下格式输出，每个脚本之间用 "---SPLIT---" 分隔：

【抖音版】
格式要求：
- 前15秒钩子：极具冲击力的开场，制造悬念或强烈对比，让人忍不住继续看
- 60秒核心口播：节奏感强，每句话都要有画面感，突出三大卖点
- 行动号召：明确引导用户点击/留言/预约
风格：快节奏、直接、有冲击力，语气年轻化

---SPLIT---

【小红书版】
格式要求：
- 种草风格，像朋友分享宝藏房源
- 用第一人称，带入真实看房体验感
- 分点列出惊喜发现，加入emoji点缀
- 结尾引导收藏和评论
风格：真实感、生活化、有温度，像素人推荐

---SPLIT---

【视频号版】
格式要求：
- 信任感风格，专业顾问口吻
- 从市场趋势或置业逻辑切入，建立专业感
- 理性分析价值，打消顾虑
- 结尾给出明确建议和联系方式引导
风格：专业、有深度、值得信赖

注意：直接输出脚本内容，不要有多余的说明文字。三个脚本之间严格用 "---SPLIT---" 分隔。`;

  const apiKey = process.env.CLAUDE_API_KEY;
  const apiBase = (process.env.CLAUDE_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');

  try {
    const upstream = await fetch(`${apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data?.error?.message || '上游请求失败' });
    }

    // Increment usage only on success
    usageMap[key] = count + 1;
    const remaining = DAILY_LIMIT - (count + 1);

    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text, remaining });
  } catch (err) {
    return res.status(500).json({ error: '服务器内部错误：' + err.message });
  }
}
