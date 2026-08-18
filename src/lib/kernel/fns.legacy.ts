async function phpFn(name: string, arg?: { data?: unknown } | unknown) {
  const data =
    arg && typeof arg === "object" && arg !== null && "data" in arg
      ? (arg as { data: unknown }).data
      : arg;
  const res = await fetch("api/fn.php", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ fn: name, data }),
  });
  const json = (await res.json()) as { data?: unknown; error?: string };
  if (!res.ok) throw new Error(json.error || "api");
  return json.data;
}

function wrap(name: string) {
  return (arg?: { data?: unknown } | unknown) => phpFn(name, arg);
}

export const getMyStudio = wrap("getMyStudio");
export const claimPromo = wrap("claimPromo");
export const buyUnlock = wrap("buyUnlock");
export const listPromosAdmin = wrap("listPromosAdmin");
export const savePromo = wrap("savePromo");
export const getStaffDesk = wrap("getStaffDesk");
export const appointStaff = wrap("appointStaff");
export const removeStaff = wrap("removeStaff");
export const listWatchCatalog = wrap("listWatchCatalog");
export const claimWatch = wrap("claimWatch");
export const fetchYoutubeMeta = wrap("fetchYoutubeMeta");
export const upsertWatchVideo = wrap("upsertWatchVideo");
export const listWatchAdmin = wrap("listWatchAdmin");
export const listMyVideos = wrap("listMyVideos");
export const redeemPrepaid = wrap("redeemPrepaid");
export const issuePrepaid = wrap("issuePrepaid");
export const listPrepaidAdmin = wrap("listPrepaidAdmin");
export const listPublicBanners = wrap("listPublicBanners");
export const recordBannerEvent = wrap("recordBannerEvent");
export const claimBannerInk = wrap("claimBannerInk");
export const listMyBanners = wrap("listMyBanners");
export const publishBanner = wrap("publishBanner");
export const setBannerActive = wrap("setBannerActive");
export const deleteBanner = wrap("deleteBanner");
export const saveBannerHref = wrap("saveBannerHref");
export const getConnectorSettings = wrap("getConnectorSettings");
export const saveConnectorSettings = wrap("saveConnectorSettings");
export const beginMaterialRegister = wrap("beginMaterialRegister");
export const finishMaterialRegister = wrap("finishMaterialRegister");
export const cancelMaterialRegister = wrap("cancelMaterialRegister");
export const listMaterials = wrap("listMaterials");
export const getMaterialImage = wrap("getMaterialImage");
export const setWatchActive = wrap("setWatchActive");
export const setPromoActive = wrap("setPromoActive");
export const getOpsOverview = wrap("getOpsOverview");
