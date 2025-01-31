interface ValidationResponse {
  isCorrect: boolean;
  explanation: string;
}

interface GenerateInputResponse {
  input: string;
}

export const agentTestApi = {
  async evaluateAgent(agentEndpoint: string, input: any, headers?: Record<string, string>) {
    const res = await fetch('/api/tools/evaluate-agent', {
      method: 'POST',
      body: JSON.stringify({ agentEndpoint, testCases: [{ input }], headers })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.results[0];
  },

  async validateResponse(actualResponse: any, expectedOutput: string) {
    const res = await fetch('/api/tools/validate-response', {
      method: 'POST',
      body: JSON.stringify({ actualResponse, expectedOutput })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  }
}; 