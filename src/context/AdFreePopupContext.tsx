import React, { createContext, useContext, useMemo } from 'react';

interface AdFreePopupContextType {
  showAdFreePopup: boolean;
  adType: 'ad1' | 'ad2';
  playerToShow: string | null;
  shouldLoadIframe: boolean;
  isSpecialPlayer: boolean;
  isVoVostfrOnly: boolean;
  is_vip: boolean;
  showPopupForPlayer: (playerType: string, additionalInfo?: any) => void;
  handlePopupClose: () => void;
  handlePopupAccept: () => void;
  resetVipStatus: () => void;
}

const AdFreePopupContext = createContext<AdFreePopupContextType | undefined>(undefined);

export const AdFreePopupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // LKS TV — site privé sans pub : is_vip toujours true, aucun popup publicitaire
  const showPopupForPlayer = () => { /* no-op */ };
  const handlePopupClose = () => { /* no-op */ };
  const handlePopupAccept = () => { /* no-op */ };
  const resetVipStatus = () => { /* no-op */ };

  const value = useMemo<AdFreePopupContextType>(() => ({
    showAdFreePopup: false,
    adType: 'ad2',
    playerToShow: null,
    shouldLoadIframe: true,
    isSpecialPlayer: false,
    isVoVostfrOnly: false,
    is_vip: true,
    showPopupForPlayer,
    handlePopupClose,
    handlePopupAccept,
    resetVipStatus,
  }), []);

  return (
    <AdFreePopupContext.Provider value={value}>
      {children}
    </AdFreePopupContext.Provider>
  );
};

export const useAdFreePopup = () => {
  const context = useContext(AdFreePopupContext);
  if (context === undefined) {
    throw new Error('useAdFreePopup must be used within an AdFreePopupProvider');
  }
  return context;
};