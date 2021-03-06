import Ember from "ember";

export default Ember.Controller.extend({
  // GitHub auth params
  queryParams: ['error_description','state','code','isTest'],

  error: null,
  error_description: null,
  state: null,
  code: null,
  isTest: null,

  absoluteEndpoint: function() {
    var url = this.get('app.endpoint');

    // If the URL is relative, add on the current base URL from the browser
    if ( url.indexOf('http') !== 0 )
    {
      url = window.location.origin + '/' + url.replace(/^\/+/,'');
    } 

    // URL must end in a single slash
    url = url.replace(/\/+$/,'') + '/';

    return url;
  }.property('app.endpoint'),

  endpointHost: function() {
    var a = document.createElement('a');
    a.href = this.get('absoluteEndpoint');
    return a.host;
  }.property('absoluteEndpoint')
});
