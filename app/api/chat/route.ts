import { kv } from '@vercel/kv';
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { auth } from '@/auth';
import { nanoid } from '@/lib/utils';

export const runtime = 'edge';

const mistral = new ChatMistralAI({
  apiKey: process.env.MISTRAL_API_KEY,
  modelName: "mixtral8x7b", // Make sure this is the correct model name
});

export async function POST(req: Request) {
  const json = await req.json();
  const { messages } = json;
  const userId = (await auth())?.user.id;

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    });
  }

  // Prepare the prompt
  const promptMessages = messages.map(msg => [msg.role, msg.content]);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant"],
    ...promptMessages
  ]);

  // Use StringOutputParser for streaming responses
  const outputParser = new StringOutputParser();
  const chain = prompt.pipe(mistral).pipe(outputParser);

  // Initiate the stream
  const stream = await chain.stream({
    input: messages[messages.length - 1].content // Assuming the last message is the input to the AI
  });

  // Assemble streaming response
  let streamResponse = '';
  for await (const item of stream) {
    streamResponse += item;
  }

  // The assembled response can then be saved and/or returned
  // You might need to adjust the storage logic based on how you want to store this data
  const title = messages[0].content.substring(0, 100); // for example, using the first 100 chars as title
  const id = json.id ?? nanoid();
  const createdAt = Date.now();
  const path = `/chat/${id}`;
  const payload = {
    id,
    title,
    userId,
    createdAt,
    path,
    messages: [
      ...messages,
      {
        content: streamResponse,
        role: 'assistant'
      }
    ]
  };

  // Save the chat to KV storage
  await kv.hmset(`chat:${id}`, payload);
  await kv.zadd(`user:chat:${userId}`, {
    score: createdAt,
    member: `chat:${id}`
  });

  return new Response(streamResponse, {
    headers: {
      'Content-Type': 'text/plain'
    }
  });
}
