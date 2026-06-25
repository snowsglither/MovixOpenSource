import React, { createContext, useContext, useMemo } from 'react';

interface AdWarningContextType {
  showAdWarning: boolean;
  setShowAdWarning: (show: boolean) => void;
  handleAccept: () => void;
}

const AdWarningContext = createContext<AdWarningContextType | undefined>(undefined);

export const AdWarningProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // LKS TV — site privé sans pub : avertissement publicitaire désactivé
  const value = useMemo(
    () => ({
      showAdWarning: false,
      setShowAdWarning: () => { /* no-op */ },
      handleAccept: () => { /* no-op */ },
    }),
    []
  );

  return (
    <AdWarningContext.Provider value={value}>
      {children}
    </AdWarningContext.Provider>
  );
};

export const useAdWarning = () => {
  const context = useContext(AdWarningContext);
  if (context === undefined) {
    throw new Error('useAdWarning must be used within an AdWarningProvider');
  }
  return context;
};
