import { Suspense } from 'react';
import { Landing } from '@/components/landing/Landing';

export default function HomePage() {
  return (
    <Suspense fallback={<div className="felt min-h-dvh" />}>
      <Landing />
    </Suspense>
  );
}
