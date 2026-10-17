import type { Metadata } from 'next';
import { SoloScreen } from '@/components/SoloScreen';

export const metadata: Metadata = { title: 'Parkway — solo game' };

export default function PlayPage() {
  return <SoloScreen />;
}
