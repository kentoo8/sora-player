export type Video = {
  id: string;
  filename: string;
  url: string;
  timestamp: number;
  title: string;
  prompt: string;
  account?: string;
  thumbnail?: string;
  tags?: string[];
};
