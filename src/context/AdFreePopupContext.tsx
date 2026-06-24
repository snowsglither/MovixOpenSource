import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { isUserVip } from '../utils/vipUtils';


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
  const [showAdFreePopup, setShowAdFreePopup] = useState(false);
  const [adType, setAdType] = useState<'ad1' | 'ad2'>('ad2');
  const [playerToShow, setPlayerToShow] = useState<string | null>(null);
  const [shouldLoadIframe, setShouldLoadIframe] = useState(true);
  const [isSpecialPlayer, setIsSpecialPlayer] = useState(false);
  const [isVoVostfrOnly, setIsVoVostfrOnly] = useState(false);
  const [is_vip, setIsVip] = useState(() => {
    // Check VIP status via server-verified utility
    return isUserVip();
  });

  // Effect to listen for changes to VIP status (localStorage + custom events)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'is_vip') {
        setIsVip(e.newValue === 'true');
      }
    };

    const handleVipStatusChanged = () => {
      setIsVip(isUserVip());
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('vipStatusChanged', handleVipStatusChanged);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('vipStatusChanged', handleVipStatusChanged);
    };
  }, []);

  const showPopupForPlayer = useCallback((_playerType: string, _additionalInfo?: any) => {
    // LKS TV — pas de publicité, accès direct pour tous
    setShouldLoadIframe(true);
  }, []);

  const handlePopupClose = useCallback(() => {
    setShowAdFreePopup(false);
    setPlayerToShow(null);
  }, []);

  const handlePopupAccept = useCallback(() => {
    setShowAdFreePopup(false);
    setIsVip(true);
    setShouldLoadIframe(true);
    // Don't set localStorage here - this is temporary for the session only
    try {
      const evt = new CustomEvent('ad_popup_accepted', { detail: { timestamp: Date.now() } });
      window.dispatchEvent(evt);
    } catch { }
  }, []);

  const resetVipStatus = useCallback(() => {
    // Don't reset if localStorage has permanent VIP status
    if (localStorage.getItem('is_vip') !== 'true') {
      setIsVip(false);
      console.log('[AdFreePopupContext] VIP status reset.');
    }
  }, []);

  // Memoize the context value so the 7 consumers (Movie/TVDetails, Watch
  // pages, MovieVideoPlayer, AdFreePlayerAds) don't re-render on every parent
  // render. AdFreePopupProvider sits near the root of the App provider stack,
  // so anything its parents re-render for (route changes, auth ticks) used to
  // cascade into the heavy detail pages via this provider. — perf
  const value = useMemo<AdFreePopupContextType>(() => ({
    showAdFreePopup,
    adType,
    playerToShow,
    shouldLoadIframe,
    isSpecialPlayer,
    isVoVostfrOnly,
    is_vip,
    showPopupForPlayer,
    handlePopupClose,
    handlePopupAccept,
    resetVipStatus
  }), [
    showAdFreePopup,
    adType,
    playerToShow,
    shouldLoadIframe,
    isSpecialPlayer,
    isVoVostfrOnly,
    is_vip,
    showPopupForPlayer,
    handlePopupClose,
    handlePopupAccept,
    resetVipStatus
  ]);

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