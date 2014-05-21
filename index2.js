/**
 * Module dependencies
 */

var URL               = require('url')
  , request           = require('superagent')
  , CallbackError     = require('./errors/CallbackError')
  , IDToken           = require('./lib/IDToken')
  , AccessToken       = require('./lib/AccessToken')
  , UnauthorizedError = require('./errors/UnauthorizedError')
  //, UserInfoError     = require('./lib/UserInfoError')
  , FormUrlencoded    = require('form-urlencoded')
  ;


/**
 * Anvil Connect Client
 */

module.exports = {


  /**
   * Anvil Connect Provider Settings
   */

  provider: {
    // uri
    // key
  },


  /**
   * Registered Client Settings
   */

  client: {
    // id
    // token
  },


  /**
   * Default Authorization Request Params
   */

  params: {
    // responseType
    // redirectUri
    // scope
  },


  /**
   * Client Configuration Setter
   */

  configure: function (options) {

    // validate configuration
    if (!options) {
      throw new Error('A valid configuration is required.');
    }

    if (!options.provider) {
      throw new Error('A valid provider configuration is required');
    }

    if (!options.provider.uri) {
      throw new Error('Provider uri is required');
    }

    if (!options.provider.key) {
      throw new Error('Provider public key is required');
    }

    if (!options.client) {
      throw new Error('A valid client configuration is required');
    }

    if (!options.client.id) {
      throw new Error('Client ID is required');
    }

    if (!options.client.token) {
      throw new Error('Client token is required');
    }

    if (!options.params) {
      throw new Error('Valid authorization params configuration is required');
    }

    if (!options.params.redirectUri) {
      throw new Error('Redirect URI is required');
    }


    // default values
    if (!options.params.responseType) {
      options.params.responseType = 'code';
    }

    if (!options.params.scope) {
      options.params.scope = 'openid profile';
    }


    // initialize settings
    this.provider = options.provider;
    this.client   = options.client;
    this.params   = options.params;
  },


  /**
   * URI Generator
   *
   * Example:
   *
   *    var uri = anvil.uri({
   *      endpoint: 'signin',
   *      // override defaults here
   *    })
   */

  uri: function (options) {
    var anvil    = this
      , options  = options || {}
      , provider = anvil.provider
      , client   = anvil.client
      , params   = anvil.params
      , uri      = anvil.provider.uri + '/'
                 + (options.endpoint || 'authorize') + '?'
                 ;

    var params = {
      response_type: options.responseType || params.responseType || 'code',
      redirect_uri:  options.redirectUri  || params.redirectUri,
      client_id:     options.clientId     || client.id,
      scope:         options.scope        || params.scope
    };

    // optionally add state onto params
    // and any other options like prompt/display/etc

    return uri + FormUrlencoded.encode(params);
  },


  /**
   * Authorize
   * - redirect to the authorize endpoint
   *
   *   app.get('/authorize', anvil.authorize({
   *     // options
   *   }));
   */

  authorize: function (options) {
    var anvil   = this
      , options = options || {}
      ;

    return function (req, res, next) {
      res.redirect(anvil.uri({
        endpoint:     options.endpoint || 'authorize',
        responseType: options.responseType,
        redirectUri:  options.redirectUri,
        clientId:     options.clientId,
        scope:        options.scope
      }));
    };
  },


  /**
   * Signin
   * - redirect directly to signin endpoint
   *
   *   app.get('/signin', anvil.signin());
   */

  signin: function (options) {
    options = options || {};
    options.endpoint = 'signin';
    return this.authorize(options);
  },


  /**
   * Signup
   * - redirect directly to signup endpoint
   */

  signup: function (options) {
    options = options || {};
    options.endpoint = 'signup';
    return this.authorize(options);
  },


  /**
   * Connect a Third Party Account
   *
   *    app.get('/signin/:provider', anvil.connect({
   *      provider: req.params.provider
   *    }));
   */

  connect: function (options) {
    options = options || {};
    options.provider = options.provider;
    options.endpoint = 'connect/' + options.provider;
    return this.authorize(options);
  },


  /**
   * Callback Handler
   *
   *    anvil.callback(req.url, function (err, authorization) {
   *
   *      // `authorization.tokens` contains the auth server's token endpoint response
   *      //
   *      //    authorization.tokens.access_token
   *      //    authorization.tokens.refresh_token
   *      //    authorization.tokens.expires_in
   *      //    authorization.tokens.id_token
   *
   *      // `authorization.identity` contains the decoded and verified claims of the id_token
   *      //
   *      //    authorization.identity.iss
   *      //    authorization.identity.sub
   *      //    authorization.identity.aud
   *      //    authorization.identity.exp
   *      //    authorization.identity.iat
   *
   *    });
   *
   * Can this be used inside a Passport Strategy?
   */

  callback: function (uri, callback) {
    var anvil        = this
      , provider     = anvil.provider
      , client       = anvil.client
      , params       = anvil.params
      , authResponse = URL.parse(uri, true).query
      ;

    // handle error response from authorization server
    if (authResponse.error) {
      return callback(new CallbackError(authResponse));
    }

    // token request parameters
    var tokenRequest = FormUrlencoded.encode({
      grant_type:   'authorization_code',
      redirect_uri:  params.redirectUri,
      code:          authResponse.code
    });

    // exchange authorization code for tokens
    request
      .post(provider.uri + '/token')
      .set('Authorization', 'Bearer ' + client.token)
      .send(tokenRequest)
      .end(function (err, tokenResponse) {
        // superagent error
        if (err) {
          return callback(err)
        }

        // Forbidden client or invalid request error
        if (tokenResponse.error) {
          return callback(new CallbackError(tokenResponse.body))
        }

        // Successful token response
        else {
          IDToken.verify(tokenResponse.body.id_token, {

            iss: provider.uri,
            aud: client.id,
            key: provider.key

          }, function (err, token) {

            // token error
            if (err) {
              return callback(err);
            }

            // success response
            callback(null, {
              tokens: tokenResponse.body,
              identity: token.payload
            });

          });
        }
      });
  },


  /**
   * UserInfo
   *
   *    anvil.userInfo(accessToken, function (err, info) {
   *
   *      // `info` contains basic account information for the user
   *      // represented by the accessToken argument.
   *      //
   *      //    info.sub
   *      //    info.name
   *      //    info.given_name
   *      //    info.family_name
   *      //    info.middle_name
   *      //    info.nickname
   *      //    info.perferred_username
   *      //    info.profile
   *      //    info.picture
   *      //    info.website
   *      //    info.email
   *      //    info.email_verified
   *      //    info.gender
   *      //    info.birthdate
   *      //    info.zoneinfo
   *      //    info.locale
   *      //    info.phone_number
   *      //    info.phone_number_verified
   *      //    info.address
   *      //    info.updated_at
   *
   *    });
   */

  userInfo: function (accessToken, callback) {
    var anvil    = this
      , provider = anvil.provider
      ;

    request
      .get(anvil.provider.uri + '/userinfo')
      .set('Authorization', 'Bearer ' + accessToken)
      .set('Accept',        'application/json')
      .end(function (err, response) {
        // superagent error
        if (err) {
          return callback(err);
        }

        // error response from authorization server
        if (response.error) {
          return callback(new UnauthorizedError(response.body));
        }

        // success
        callback(null, response.body);
      });
  },


  /**
   * Verify credentials at API endpoints
   *
   * This should comply with RFC6750:
   * http://tools.ietf.org/html/rfc6750
   *
   * Use as route specific middleware:
   *
   *    var authorize = anvil.verify({ scope: 'research' });
   *
   *    server.post('/protected', authorize, function (req, res, next) {
   *      // handle the request
   *    });
   *
   * Or protect the entire server:
   *
   *    server.use(anvil.verify({ scope: 'research' }));
   *
   */

  verify: function (options) {
    var anvil     = this
      , provider  = anvil.provider
      , client    = anvil.client
      , options   = options || {}
      , scope     = options.scope
      , key       = provider.key
      ;

    return function (req, res, next) {

      // try to find an access token for the request
      var accessToken = (

          // Authorization Request Header Field
          req.headers.authorization
       && req.headers.authorization.replace('Bearer ', '')

          // URI Query Parameter
       || req.query.access_token

          // Form-Encoded Body Parameter
       || req.headers['content-type'] === 'application/x-www-form-urlencoded'
       && req.query.body

      );

      // Missing access token
      if (!accessToken) {
        return next(new UnauthorizedError({
          realm:              'user',
          error:              'invalid_request',
          error_description:  'An access token is required',
          statusCode:          400
        }));
      }

      // Access token found
      else {
        AccessToken.verify(accessToken, {

          // Token validation parameters
          jwt:    client.token,
          key:    provider.key,
          iss:    provider.uri,
          aud:    client.id,
          scope:  scope

        }, function (err, token) {

          // Validation error
          if (err) {
            return next(err);
          }

          // Make the token metadata available downstream
          req.token = token;
          next();

        });
      }
    }
  }

};
