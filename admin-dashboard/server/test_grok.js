require('dotenv').config();
const content = "App như lol v";
const GROK_KEY = process.env.GROK_API_KEY;

async function test() {
    console.log(`[Grok] Checking: "${content}"`);
    try {
        const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROK_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "grok-4-1-fast-non-reasoning",
                messages: [
                    { role: "system", content: "Bạn là robot kiểm duyệt bình luận thô tục cực kỳ khắt khe. Nếu bình luận chứa từ bậy, tiếng lóng thô lỗ (lol, cút, xàm, ngu, đm, vcl, ...) hoặc xúc phạm người khác, hãy trả về 'tieu cuc'. Ngược lại trả về 'binh thuong'. Chỉ trả về 1 từ duy nhất." },
                    { role: "user", content: content }
                ],
                temperature: 0
            })
        });
        const grokData = await grokRes.json();
        console.log('Grok full response:', JSON.stringify(grokData, null, 2));
        if (grokData && grokData.choices && grokData.choices[0]) {
            const answer = (grokData.choices[0].message.content || '').toLowerCase().trim();
            console.log(`[Grok] Classification result: "${answer}"`);
        } else {
            console.log('[Grok] No choices found');
        }
    } catch (e) {
        console.error('[Grok] Error:', e.message);
    }
}

test();
