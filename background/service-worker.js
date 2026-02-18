importScripts('../config.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from this extension
  if (sender.id !== chrome.runtime.id) return;

  if (message.type === 'GENERATE_ALL') {
    handleGenerateAll(message.postData, message.projectId, message.subredditRules, message.replyTo)
      .then(responses => sendResponse({ responses }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleGenerateAll(postData, projectId, subredditRules, replyTo) {
  const payload = {
    subreddit: postData.subreddit,
    title: postData.title,
    body: postData.body || '',
    comments: postData.comments || '',
    tones: CONFIG.TONES,
    projectId: projectId || 'none',
    subredditRules: subredditRules || ''
  };

  // Include reply context if replying to a specific comment
  if (replyTo) {
    payload.replyTo = replyTo;
  }

  const res = await fetch(CONFIG.API_URL + '/api/v1/reddit-generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Extension-Id': chrome.runtime.id,
      'X-Extension-Name': 'RedditOutreach'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errBody = await res.text();
    if (res.status === 429) throw new Error('Rate limit exceeded — wait a moment');
    if (res.status === 503) throw new Error('AI service unavailable');
    console.error(`API error (${res.status}):`, errBody.slice(0, 500));
    throw new Error('Failed to generate response. Please try again.');
  }

  const data = await res.json();
  if (!data.responses) throw new Error('Empty response from API');
  return data.responses;
}
