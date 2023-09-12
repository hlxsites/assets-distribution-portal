import { loadScript } from './lib-franklin.js';
import { fetchCached } from './fetch-util.js';
import { fetchSiteConfig } from './site-config.js';

let isIMSInitialized = false;
const config = await fetchSiteConfig('main');
const environment = config.find((elem) => elem.configProperty === 'imsEnvironment')?.value === 'stage' ? 'stg1' : 'prod';
const imsOrgID = config.find((elem) => elem.configProperty === 'imsOrg')?.value;
let imsUserGroup = config.find((elem) => elem.configProperty === 'imsUserGroup')?.value;
if (!imsUserGroup) {
  imsUserGroup = 'assets-distribution-portal-users';
}

const IMS_CONFIG = {
  xApiKey: 'assets-distribution-portal',
  scope: 'openid,AdobeID,additional_info.projectedProductContext,read_organizations',
  urls: {
    stg1: 'https://auth-stg1.services.adobe.com/imslib/imslib.js',
    prod: 'https://auth.services.adobe.com/imslib/imslib.min.js',
    ims: {
      stg1: 'https://ims-na1-stg1.adobelogin.com',
      prod: 'https://ims-na1.adobelogin.com',
    },
  },
};

async function getBearerTokenFromIMS(callWithToken) {
  if (window.adobeIMS?.getAccessToken() && window.adobeIMS.getAccessToken().token) {
    callWithToken(window.adobeIMS.getAccessToken().token);
    return;
  }
  if (window.adobeIMS?.getReauthAccessToken() && window.adobeIMS.getReauthAccessToken().token) {
    callWithToken(window.adobeIMS.getReauthAccessToken().token);
    return;
  }
  window.adobeid = {
    client_id: IMS_CONFIG.xApiKey,
    scope: IMS_CONFIG.scope,
    locale: 'en_US',
    autoValidateToken: true,
    uses_redirect_mode: true,
    environment,
    onReady() {
      if (window.adobeIMS.isSignedInUser()) {
        let tokenDetails = window.adobeIMS?.getAccessToken();
        if (!tokenDetails) {
          tokenDetails = window.adobeIMS?.getReauthAccessToken();
        }
        const token = tokenDetails && tokenDetails.token;
        callWithToken(token);
      } else {
        window.adobeIMS.reAuthenticate();
      }
    },
  };

  if (!isIMSInitialized) {
    // load ims.min.js
    await loadScript(IMS_CONFIG.urls[environment]);
    isIMSInitialized = true;
  }
}

function getBearerTokenInLocalStorage() {
  if (localStorage.getItem('bearerToken')) {
    return localStorage.getItem('bearerToken');
  }
  return null;
}

/**
 * Get the bearer token from local storage or prompt for it.
 * @param {*} forceReset force the user to re-enter the bearer token
 * @returns the bearer token
 */
// eslint-disable-next-line import/prefer-default-export
export async function getBearerToken() {
  let token = getBearerTokenInLocalStorage();
  if (!token) {
    token = await new Promise((resolve) => {
      getBearerTokenFromIMS((bearerToken) => {
        resolve(bearerToken);
      });
    });
  }
  return `Bearer ${token}`;
}

export async function getUserProfile() {
  const userProfile = await window.adobeIMS.getProfile();
  return userProfile;
}

async function getIMSOrgData() {
  const bearerToken = await getBearerToken();
  const imsData = await fetchCached(
    `${IMS_CONFIG.urls.ims[environment]}/ims/organizations/v6?client_id=${IMS_CONFIG.xApiKey}`,
    {
      method: 'GET',
      headers: {
        Authorization: bearerToken,
      },
    },
  );
  return imsData;
}

async function getSecurityGroupMemberships() {
  let imsOrgData = await getIMSOrgData();
  if (imsOrgData && Array.isArray(imsOrgData) && imsOrgData.length > 0) {
    imsOrgData = imsOrgData.find((elem) => elem.orgRef.ident === imsOrgID.replace('@AdobeOrg', ''));
    if (imsOrgData && imsOrgData.groups) {
      return imsOrgData.groups;
    }
  }
  return [];
}

async function isUserInSecurityGroup(securityGroup) {
  const securityGroupMemberships = await getSecurityGroupMemberships();
  return securityGroupMemberships.find((elem) => elem.groupName === securityGroup) !== undefined;
}

export async function checkUserAccess() {
  return isUserInSecurityGroup(imsUserGroup);
}
