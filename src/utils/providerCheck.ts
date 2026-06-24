import axios from 'axios';

const MAIN_API = import.meta.env.VITE_MAIN_API as string;

export const checkContentAvailability = async (contentId: number, mediaType: 'movie' | 'tv') => {
  const [frembedResult] = await Promise.allSettled([
    checkFrembedAvailability(contentId, mediaType),
  ]);

  return {
    Frembed: frembedResult.status === 'fulfilled' ? frembedResult.value : false,
  } as Record<string, boolean>;
};

const checkFrembedAvailability = async (contentId: number, mediaType: 'movie' | 'tv') => {
  try {
    const response = await axios.get(`${MAIN_API}/api/frembed/check/${mediaType}/${contentId}`, { timeout: 5000 });
    return response.data?.status === 200 && !!response.data?.result;
  } catch {
    return false;
  }
};

const checkStreamtapeAvailability = async (contentId: number, mediaType: 'movie' | 'tv') => {
  try {
    const endpoint = `${PROVIDERS.STREAMTAPE.checkUrl}/check/${mediaType}/${contentId}`;
    const response = await axios.get(endpoint);
    return response.data.available;
  } catch (error) {
    console.error(`Error checking Streamtape availability:`, error);
    return false;
  }
}; 