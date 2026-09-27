import https from 'https';
import fs from 'fs';
import path from 'path';

export function parseGeminiResponse(responsePayload) {
  const payload =
    typeof responsePayload === 'string'
      ? JSON.parse(responsePayload)
      : responsePayload;

  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text ?? '')
      .join('') ||
    payload?.choices?.[0]?.message?.content ||
    '';

  const trimmed = String(text).trim();
  const normalized = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(normalized);
}

/**
 * AI Supervisor: Validates deterministic findings or acts as an intelligent fallback.
 * @param {import('./types.js').LogEvent[]} logWindow - Recent timeline log rows
 * @param {Object|null} localFinding - The top finding from your rule engines (if any)
 * @returns {Promise<Object>} The finalized visual diagnostic finding
 */

export function superviseWithAI(logWindow, localFinding) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return resolve({
        success: false,
        message:
          "AI configuration missing. Export your key in your terminal: export GEMINI_API_KEY='your-key'",
      });
    }

    const formattedTimeline = logWindow
      .map((log) => {
        let time = '00:00:00';
        try {
          const d = new Date(log.timestamp);
          if (!isNaN(d.getTime())) time = d.toLocaleTimeString();
          else if (log.timestamp) time = String(log.timestamp);
        } catch {
          time = '00:00:00';
        }
        const sName = String(log.service || 'service').toUpperCase();
        const sLevel = String(log.level || 'info').toUpperCase();
        return `[${time}] [${sName}] [${sLevel}] ${log.message}`;
      })
      .join('\n');

    // 1. Establish the operational mode context for our system prompt framework
    const mode = localFinding ? 'VERIFICATION' : 'FALLBACK';

    const systemPrompt = `You are the master supervisor engine for TraceWatch. 
    Your job is to look at local multi-service logs and act as an expert debugging copilot.

    OPERATIONAL MODE: ${mode}
    ${
      localFinding
        ? `
    A local rule has flagged an issue:
    - Rule ID: "${localFinding.rule}"
    - Inferred Cause: "${localFinding.cause}"
    
    Task: Screen the logs to verify if this local finding is accurate. 
    If TRUE, validate it, raise confidence if appropriate, and enrich the next steps explanation.
    If FALSE, override it completely, ignore the rule, and analyze the real cause.`
        : `
    No local rules triggered matching signatures.
    Task: Sweep the raw timeline logs, find the microservice failure cascade, and isolate the root cause.`
    }

    CRITICAL: Output your response ONLY as a raw, valid JSON object matching this structure exactly. Do not wrap it in markdown formatting:
    {
      "cause": "One-sentence plain explanation of what broke.",
      "confidence": 0.95,
      "rule": "${localFinding ? localFinding.rule : 'ai-fallback'}",
      "evidence": ["The exact text string from the 1 or 2 core log rows that prove the crash"],
      "fix": "Clear, bulleted step-by-step terminal action items to fix the problem."
    }`;

    // GEMINI NATIVE PAYLOAD STRUCTURE
    const promptPayload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Here is the current log stream snapshot:\n\n${formattedTimeline}`,
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.15,
        responseMimeType: 'application/json',
      },
    };

    const dataString = JSON.stringify(promptPayload);

    const requestOptions = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: '/v1beta/models/gemini-2.5-pro:generateContent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(dataString),
      },
    };

    const req = https.request(requestOptions, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed.error)
            return resolve({ success: false, message: parsed.error.message });

          const cleanJson = parseGeminiResponse(parsed);
          resolve({ success: true, ...cleanJson });
        } catch (err) {
          resolve({
            success: false,
            message:
              'AI response compilation failed. Please click explain again.',
          });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(dataString);
    req.end();
  });
}

/**
 * AI Stack Fallback: Uses Gemini to inspect an unrecognized codebase directory and infer service configurations.
 * Kept intentionally lightweight and non-intensive: only called as a fallback when deterministic heuristics find no supported services.
 * @param {string} cwd - Base directory to inspect
 * @returns {Promise<{ success: boolean, services?: Array<Object>, message?: string }>}
 */
export function inferStackWithAI(cwd = process.cwd()) {
  return new Promise((resolve) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return resolve({
        success: false,
        message: 'AI configuration missing (GEMINI_API_KEY).',
      });
    }

    const filesSummary = [];
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          ['node_modules', 'dist', 'build', 'coverage', '.git'].includes(
            entry.name,
          )
        ) {
          continue;
        }
        if (entry.isDirectory()) {
          try {
            const subEntries = fs
              .readdirSync(path.join(cwd, entry.name))
              .slice(0, 10);
            filesSummary.push(
              `Directory "${entry.name}" containing: ${subEntries.join(', ')}`,
            );
          } catch {
            filesSummary.push(`Directory "${entry.name}"`);
          }
        } else {
          let extra = '';
          if (entry.name === 'package.json') {
            try {
              const pkg = JSON.parse(
                fs.readFileSync(path.join(cwd, entry.name), 'utf-8'),
              );
              extra = ` (scripts: ${Object.keys(pkg.scripts || {}).join(', ')}; deps: ${Object.keys(pkg.dependencies || {}).slice(0, 10).join(', ')})`;
            } catch {}
          }
          filesSummary.push(`File "${entry.name}"${extra}`);
        }
      }
    } catch (err) {
      return resolve({ success: false, message: err.message });
    }

    const systemPrompt = `You are an expert developer tooling assistant for TraceWatch.
Your task is to analyze an unrecognized project structure and infer the runnable local microservices (frontend, backend, workers, etc.).
Determine:
1. "name": short service name
2. "type": "frontend" or "backend"
3. "framework": framework or runtime name
4. "command": command to start the service (e.g. "pnpm run start/pure", "pnpm dev", "node server.js", "cargo run", etc.)
5. "cwd": relative directory if located in a subfolder (omit or "." if root)

CRITICAL: Output your response ONLY as a raw, valid JSON object matching this structure exactly without markdown code blocks:
{
  "services": [
    {
      "name": "backend",
      "type": "backend",
      "framework": "Node.js",
      "command": "pnpm run start/pure",
      "cwd": "backend"
    }
  ]
}`;

    const promptPayload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Here is the project directory inspection summary:\n${filesSummary.join('\n')}`,
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const dataString = JSON.stringify(promptPayload);

    const requestOptions = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: '/v1beta/models/gemini-2.5-pro:generateContent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(dataString),
      },
    };

    const req = https.request(requestOptions, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (parsed.error) {
            return resolve({ success: false, message: parsed.error.message });
          }
          const cleanJson = parseGeminiResponse(parsed);
          const services = Array.isArray(cleanJson?.services)
            ? cleanJson.services
            : [];
          resolve({ success: true, services });
        } catch {
          resolve({
            success: false,
            message: 'AI stack inference compilation failed.',
          });
        }
      });
    });

    req.on('error', (e) => resolve({ success: false, message: e.message }));
    req.write(dataString);
    req.end();
  });
}
