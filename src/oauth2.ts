import { resolve } from 'url';
import Config from './config';
import Popup from './popup';
import Storage from './storage';

export default class OAuth2 {
  static $inject = ['$http', '$window', '$timeout', 'satellizerConfig', 'satellizerPopup', 'satellizerStorage'];
  
  private defaults: {
    name: string,
    url: string,
    clientId: string,
    authorizationEndpoint: string,
    redirectUri: string,
    scopePrefix: string,
    scopeDelimiter: string,
    state?: string|(() => string),
    defaultUrlParams: Array<string>,
    responseType: string,
    responseParams: {
      code: string,
      clientId: string,
      redirectUri: string
    },
    popupOptions: { width: number, height: number }
  };

  constructor(private $http: angular.IHttpService,
              private $window: angular.IWindowService,
              private $timeout: angular.ITimeoutService,
              private satellizerConfig: Config,
              private satellizerPopup: Popup,
              private satellizerStorage: Storage) {
    this.defaults = {
      url: null,
      clientId: null,
      name: null,
      authorizationEndpoint: null,
      redirectUri: null,
      scopePrefix: null,
      scopeDelimiter: null,
      state: null,
      defaultUrlParams: ['response_type', 'client_id', 'redirect_uri'],
      responseType: 'code',
      responseParams: {
        code: 'code',
        clientId: 'clientId',
        redirectUri: 'redirectUri'
      },
      popupOptions: { width: null, height: null }
    };
  }

  init(options, data): Promise<any> {
    return new Promise((resolve, reject) => {
      Object.assign(this.defaults, options);

      this.$timeout(() => {
        const url = [this.defaults.authorizationEndpoint, this.buildQueryString()].join('?');
        const stateName = this.defaults.name + '_state'; // TODO what if name is undefined
        const { name, state, popupOptions, redirectUri, responseType } = this.defaults;

        if (typeof state === 'function') {
          this.satellizerStorage.set(stateName, state());
        } else if (typeof state === 'string') {
          this.satellizerStorage.set(stateName, state);
        }

        this.satellizerPopup.open(url, name, popupOptions, redirectUri)
          .then((oauth: any): void|Promise<any>|angular.IHttpPromise<any> => {

            if (responseType === 'token' || !url) {
              return resolve(oauth);
            }

            if (oauth.state && oauth.state !== this.satellizerStorage.get(stateName)) {
              return reject(new Error(
                'The value returned in the state parameter does not match the state value from your original ' +
                'authorization code request.'
              ));
            }

            resolve(this.exchangeForToken(oauth, data));
          })
          .catch(error => reject(error));
      });
    });
  }

  exchangeForToken(oauth, data): angular.IHttpPromise<any> {
    const payload = Object.assign({}, data);

    angular.forEach(this.defaults.responseParams, (value, key) => {
      switch (key) {
        case 'code':
          payload[value] = oauth.code;
          break;
        case 'clientId':
          payload[value] = this.defaults.clientId;
          break;
        case 'redirectUri':
          payload[value] = this.defaults.redirectUri;
          break;
        default:
          payload[value] = oauth[key];
      }
    });

    if (oauth.state) {
      payload.state = oauth.state;
    }

    let exchangeForTokenUrl = this.satellizerConfig.baseUrl ? resolve(this.satellizerConfig.baseUrl, this.defaults.url) : this.defaults.url;

    return this.$http.post(exchangeForTokenUrl, payload, { withCredentials: this.satellizerConfig.withCredentials });
  }

  buildQueryString(): string {
    const keyValuePairs = [];
    const urlParamsCategories = ['defaultUrlParams', 'requiredUrlParams', 'optionalUrlParams'];

    angular.forEach(urlParamsCategories, (paramsCategory) => {
      angular.forEach(this.defaults[paramsCategory], (paramName) => {
        const camelizedName = this.camelCase(paramName);
        let paramValue = angular.isFunction(this.defaults[paramName]) ? this.defaults[paramName]() : this.defaults[camelizedName];

        if (paramName === 'redirect_uri' && !paramValue) {
          return;
        }

        if (paramName === 'state') {
          const stateName = this.defaults.name + '_state'; // todo what if name undefined
          paramValue = encodeURIComponent(this.satellizerStorage.get(stateName));
        }

        if (paramName === 'scope' && Array.isArray(paramValue)) {
          paramValue = paramValue.join(this.defaults.scopeDelimiter);

          if (this.defaults.scopePrefix) {
            paramValue = [this.defaults.scopePrefix, paramValue].join(this.defaults.scopeDelimiter);
          }
        }

        keyValuePairs.push([paramName, paramValue]);
      });
    });

    return keyValuePairs.map(pair => pair.join('=')).join('&');
  }

  camelCase(name): string {
    return name.replace(/([\:\-\_]+(.))/g, (_, separator, letter, offset) => {
      return offset ? letter.toUpperCase() : letter;
    });
  }
}