export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { validateGenerateTestsRequest } from '@/lib/validations';
import { jsonrepair } from 'jsonrepair';
import { AnthropicModel } from '@/services/llm/enums';
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ModelFactory } from '@/services/llm/modelfactory';

function extractJSON(text: string): any {
  try {
    // Find the array start
    const jsonStart = text.indexOf('[');
    if (jsonStart === -1) {
      const objStart = text.indexOf('{');
      if (objStart === -1) {
        console.warn('No JSON structure found');
        return { evaluations: [] };
      }
      text = text.slice(objStart);
    } else {
      text = text.slice(jsonStart);
    }
    
    // Repair and parse the JSON
    const repaired = jsonrepair(text);
    const parsed = JSON.parse(repaired);
    
    // If we got an array directly, wrap it
    if (Array.isArray(parsed)) {
      return { evaluations: parsed };
    }
    
    return parsed;
  } catch (e) {
    console.warn('JSON extraction failed:', e);
    return { evaluations: [] };
  }
}

interface Evaluation {
  scenario: string;
  expectedOutput: string;
}

function isValidEvaluation(evaluation: any): evaluation is Evaluation {
  return (
    evaluation &&
    typeof evaluation === 'object' &&
    typeof evaluation.scenario === 'string' &&
    evaluation.scenario.trim().length > 0 &&
    typeof evaluation.expectedOutput === 'string' &&
    evaluation.expectedOutput.trim().length > 0
  );
}

const generateTestsTemplate = ChatPromptTemplate.fromMessages([
  ["user", `Generate diverse test cases for an API. 
{context}

Input Format Example: {inputExample}

Create 20+ varied test cases that maintain this exact input format structure but test different scenarios. Include:

1. Standard Valid Cases:
- Regular queries
- Common variations
- Different locations/contexts

2. Edge Cases:
- Very long inputs
- Special characters
- Multiple entities in query
- Numbers and mixed content

3. AI Hallucination Tests:
- Made-up but plausible-sounding places/entities
- Non-existent but realistic-looking data
- Future dates/events that don't exist yet
- Historical events with wrong dates

4. Error Cases:
- Misspelled words
- Wrong grammar
- Incomplete sentences
- Mixed languages
- Autocorrect-style errors

5. Boundary Testing:
- Empty or minimal queries
- Maximum length content
- Unicode characters
- Emojis
- HTML-like content
- SQL-like queries
- Special symbols

6. Context Confusion:
- Ambiguous queries
- Multiple possible interpretations
- Location confusion (places with same names)
- Time zone edge cases
- Historical vs current queries

Return only a JSON object in this exact format, ensuring all fields are non-null strings:
{{
  "evaluations": [
    {{
      "scenario": "Plain English description of what we're testing",
      "expectedOutput": "Plain English description of what the agent should do/respond with"
    }}
  ]
}}

Each evaluation MUST have both scenario and expectedOutput as non-empty strings.`]
]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { inputExample, agentDescription } = validateGenerateTestsRequest(body);

    if (!process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY) {
      throw new Error('API key not configured');
    }

    const model = ModelFactory.createLangchainModel(
      AnthropicModel.Sonnet3_5,
      process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY
    );

    const chain = RunnableSequence.from([
      generateTestsTemplate,
      model,
      new StringOutputParser(),
    ]);

    const response = await chain.invoke({
      context: agentDescription ? `Context: ${agentDescription}` : 'Context derived from example input below:',
      inputExample
    });
    
    let evaluations = extractJSON(response);

    // Validate the structure and filter out invalid entries
    if (!evaluations?.evaluations || !Array.isArray(evaluations.evaluations)) {
      evaluations = { evaluations: [] };
    }

    const validEvaluations = evaluations.evaluations
      .filter(isValidEvaluation)
      .map((evaluation: Evaluation) => ({
        scenario: evaluation.scenario.trim(),
        expectedOutput: evaluation.expectedOutput.trim()
      }));

    if (validEvaluations.length === 0) {
      throw new Error('No valid evaluations generated');
    }

    console.log(`Filtered ${evaluations.evaluations.length - validEvaluations.length} invalid evaluations`);

    return NextResponse.json({ 
      testCases: validEvaluations.map((evaluation: Evaluation) => ({
        id: crypto.randomUUID(),
        scenario: evaluation.scenario,
        expectedOutput: evaluation.expectedOutput
      })),
      stats: {
        total: evaluations.evaluations.length,
        valid: validEvaluations.length,
        filtered: evaluations.evaluations.length - validEvaluations.length
      }
    });
  } catch (error) {
    console.error('Test generation error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate evaluations',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 
      { status: 500 }
    );
  }
}