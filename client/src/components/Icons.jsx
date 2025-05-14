// src/components/MapIcons.js

import React from 'react';

export const PolygonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <polyline 
      points="8,32 16,8 34,10 28,32 12,36 8,32" 
      fill="none" 
      stroke="#1976d2" 
      strokeWidth="2" 
      strokeDasharray="4,2" 
    />
    <circle cx="8" cy="32" r="2" fill="#1976d2" />
    <circle cx="16" cy="8" r="2" fill="#1976d2" />
    <circle cx="34" cy="10" r="2" fill="#1976d2" />
    <circle cx="28" cy="32" r="2" fill="#1976d2" />
    <circle cx="12" cy="36" r="2" fill="#1976d2" />
  </svg>
);



export const CircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <circle cx="20" cy="20" r="18" fill="#FF5722" />
  </svg>
);

export const SquareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <rect x="6" y="6" width="28" height="28" fill="#4CAF50" />
  </svg>
);

export const HandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40">
    <path
      d="M20 30V14c0-2 1-4 4-4s4 2 4 4v10h2V10c0-2 1-4 4-4s4 2 4 4v14h2V14c0-2 1-4 4-4s4 2 4 4v16h2V18c0-2 1-4 4-4s4 2 4 4v26c0 8-6 14-14 14s-18-6-22-14l-4-8c-1-2 0-5 2-6s5-1 7 2l4 6z"
      fill="#ffffff"
      stroke="#000000"
      strokeWidth="2"
    />
  </svg>
);

export const LocateUserIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke="black" strokeWidth="2" />
        <circle cx="12" cy="12" r="9" stroke="black" strokeWidth="2" />
        <line x1="12" y1="2" x2="12" y2="5" stroke="black" strokeWidth="2" />
        <line x1="12" y1="19" x2="12" y2="22" stroke="black" strokeWidth="2" />
        <line x1="2" y1="12" x2="5" y2="12" stroke="black" strokeWidth="2" />
        <line x1="19" y1="12" x2="22" y2="12" stroke="black" strokeWidth="2" />
    </svg>
)
