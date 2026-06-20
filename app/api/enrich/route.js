import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SYSTEM_PROMPT = `You are an automated Data Enrichment Engine. Your task is to process a batch of customer feedback entries provided in a JSON array format.

For EACH object in the array, analyze the text and return an object with the same 'id'.
Strict Validation Rules:
1. sentiment: Must be exactly "positive", "negative", or "neutral". The feedback_text is the absolute source of truth.
2. category: Must be exactly one of: "Billing", "App Bug", "Delivery", "Staff/Support", or "Other".
3. issue_summary: A concise, single-line summary of the core issue in plain English.

You must return a valid JSON array matching the required schema structure with the exact same length as the input array.`;

const responseSchema = {
  type: SchemaType.ARRAY,
  description: "Array containing the enriched analysis metadata properties matched by ID.",
  items: {
    type: SchemaType.OBJECT,
    properties: {
      id: { type: SchemaType.STRING },
      sentiment: { type: SchemaType.STRING, enum: ["positive", "negative", "neutral"] },
      category: { type: SchemaType.STRING, enum: ["Billing", "App Bug", "Delivery", "Staff/Support", "Other"] },
      issue_summary: { type: SchemaType.STRING }
    },
    required: ["id", "sentiment", "category", "issue_summary"]
  }
};

// Defensive Helper: Retries the API call if the server returns a temporary 503 or 429 error
async function generateContentWithRetry(model, promptMessage, maxRetries = 3) {
  let backoffDelay = 3000; // Start with a 3-second wait frame
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(promptMessage);
    } catch (error) {
      const errorText = error.message || '';
      const isTemporaryServerFault = errorText.includes('503') || errorText.includes('429');
      
      if (isTemporaryServerFault && attempt < maxRetries) {
        console.warn(`[Gemini API Warning] Server busy (503/429). Retrying attempt ${attempt}/${maxRetries} in ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        backoffDelay *= 2; // Double the wait time for the next attempt
        continue;
      }
      throw error; // If it's a different error or we ran out of retries, throw it
    }
  }
}

export async function POST(request) {
  try {
    const { rows } = await request.json();

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", 
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.0,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const promptMessage = `Process this dataset batch array now:\n${JSON.stringify(rows)}`;
    
    // Call our resilient retry wrapper instead of hitting the raw model directly
    const result = await generateContentWithRetry(model, promptMessage);
    
    const responseText = result.response.text();
    const enrichedDataArray = JSON.parse(responseText);

    return NextResponse.json({ success: true, data: enrichedDataArray });

  } catch (error) {
    console.error('[BACKEND ERROR]:', error);
    return NextResponse.json({ error: 'LLM Processing Matrix Failed: ' + error.message }, { status: 500 });
  }
}