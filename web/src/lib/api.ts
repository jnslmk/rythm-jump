import type { ChartSavePayload } from '../features/chart/ChartEditor';

export const apiBaseUrl = '/api';

export async function saveChart(songId: string, payload: ChartSavePayload) {
  const response = await fetch(`${apiBaseUrl}/charts/${encodeURIComponent(songId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`failed to save chart for ${songId}`);
  }
}
