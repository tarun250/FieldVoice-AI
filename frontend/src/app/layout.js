import React from 'react';
import './globals.css';

export const metadata = {
  title: 'FieldVoice AI - Supervisor Control Dashboard',
  description: 'Real-time supervisor operations console with live audio playback, transcript exceptions tracking, and work order routing.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
