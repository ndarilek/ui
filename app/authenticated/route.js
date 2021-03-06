import Ember from 'ember';
import Socket from 'ui/utils/socket';
import Util from 'ui/utils/util';
import AuthenticatedRouteMixin from 'ui/mixins/authenticated-route';
import ActiveArrayProxy from 'ui/utils/active-array-proxy';
import C from 'ui/utils/constants';

export default Ember.Route.extend(AuthenticatedRouteMixin, {
  socket: null,
  pingTimer: null,

  model: function(params, transition) {
    var store = this.get('store');
    var session = this.get('session');
    var isAuthEnabled = this.get('app.authenticationEnabled');

    // Load schemas
    var headers = {};
    headers[C.HEADER.PROJECT] = undefined;
    return store.find('schema', null, {url: 'schemas', headers: headers}).then((schemas) => {
      if ( schemas && schemas.xhr )
      {
        // Save the account ID into session
        session.set(C.SESSION.ACCOUNT_ID, schemas.xhr.getResponseHeader(C.HEADER.ACCOUNT_ID));
      }

      // Save whether the user is admin
      var type = session.get(C.SESSION.USER_TYPE);
      var isAdmin = (type === C.USER.TYPE_ADMIN) || !isAuthEnabled;
      this.set('app.isAuthenticationAdmin', isAdmin);

      // Return the list of projects as the model
      return this.findUserProjects().then((all) => {
        // Load all the active projects
        var active = ActiveArrayProxy.create({sourceContent: all});
        return active;
      });
    }).catch((err) => {
      if ( [401,403].indexOf(err.status) >= 0 && isAuthEnabled )
      {
        this.send('logout',transition,true);
        return;
      }

      this.send('error',err);
    });
  },

  afterModel: function(model) {
    return this.loadPreferences().then(() => {
      return this.selectDefaultProject(model);
    });
  },

  setupController: function(controller, model) {
    controller.set('projects', model);
    this.selectDefaultProject(model, controller);
    this._super.apply(this,arguments);
  },

  loadPreferences: function() {
    var store = this.get('store');
    if ( store.hasRecordFor('schema','userpreference') )
    {
      this.set('app.hasUserPreferences', true);
      return this.get('store').find('userpreference', null, {forceReload: true}).then((prefs) => {
        if ( this.get('prefs.'+C.PREFS.I_HATE_SPINNERS) )
        {
          $('BODY').addClass('no-spin');
        }

        return prefs;
      });
    }
    else
    {
      this.set('app.hasUserPreferences', false);
      return Ember.RSVP.resolve();
    }
  },

  selectDefaultProject: function(active, controller) {
    var self = this;
    var session = this.get('session');

    // Try the project ID in the session
    return this.activeProjectFromId(session.get(C.SESSION.PROJECT)).then(select)
    .catch(() => {
      // Then the default project ID from the session
      return this.activeProjectFromId(this.get('prefs').get(C.PREFS.PROJECT_DEFAULT)).then(select)
      .catch(() => {
        this.get('prefs').set(C.PREFS.PROJECT_DEFAULT, "");

        // Then the first active project
        var project = active.get('firstObject');
        if ( project )
        {
          select(project, true);
        }
        else if ( this.get('app.isAuthenticationAdmin') )
        {
          return this.findUserProjects().then((all) => {
            var firstActive = all.filterProperty('state','active')[0];
            if ( firstActive )
            {
              select(firstActive, true);
            }
            else
            {
              fail();
            }
          }).catch(() => {
            fail();
          });
        }
        else
        {
          fail();
        }
      });
    });

    function select(project, overwriteDefault) {
      if ( project )
      {
        session.set(C.SESSION.PROJECT, project.get('id'));

        // If there is no default project, set it
        var def = self.get('prefs').get(C.PREFS.PROJECT_DEFAULT);
        if ( !def || overwriteDefault === true )
        {
          self.get('prefs').set(C.PREFS.PROJECT_DEFAULT, project.get('id'));
        }

        if ( controller )
        {
          controller.set('project', project);
        }
      }
      else
      {
        session.set(C.SESSION.PROJECT, undefined);
        if ( controller )
        {
          controller.set('project', null);
        }
      }
    }

    function fail() {
      // Then cry
      select(null);
      self.transitionTo('projects');
    }
  },

  activeProjectFromId: function(projectId) {
    // Try the currently selected one in the session
    return new Ember.RSVP.Promise((resolve, reject) => {
      if ( !projectId )
      {
        reject();
      }

      this.get('store').find('project', projectId).then((project) => {
        if ( project.get('state') === 'active' )
        {
          resolve(project);
        }
        else
        {
          reject();
        }
      }).catch(() => {
        reject();
      });
    });
  },

  findUserProjects: function() {
    var opt = {forceReload: true};
    if ( !this.get('app.authenticationEnabled') )
    {
      opt.filter = {all: 'true'};
    }

    return this.get('store').find('project', null, opt);
  },

  actions: {
    error: function(err,transition) {
      // Unauthorized error, send back to login screen
      if ( err.status === 401 )
      {
        this.send('logout',transition,true);
        return false;
      }
      else
      {
        // Bubble up
        return true;
      }
    },

    refreshProjectDropdown: function() {
      this.findUserProjects().then((res) => {
        this.set('controller.projects.sourceContent', res);
        this.selectDefaultProject(this.get('controller.projects'), this.get('controller'));
      });
    },

    switchProject: function(projectId) {
      this.intermediateTransitionTo('authenticated');
      this.get('session').set(C.SESSION.PROJECT, projectId);
      this.get('store').reset();
      if ( !projectId )
      {
        this.selectDefaultProject(this.get('controller.projects'), this.get('controller'));
      }
      this.refresh();
    },

    // Raw message from the WebSocket
    //subscribeMessage: function(/*data*/) {
      //console.log('subscribeMessage',data);
    //},

    // WebSocket connected
    subscribeConnected: function(tries,msec) {
      var msg = 'Subscribe connected';
      if (tries > 0)
      {
        msg += ' (after '+ tries + ' ' + (tries === 1 ? 'try' : 'tries');
        if (msec)
        {
          msg += ', ' + (msec/1000) + ' sec';
        }

        msg += ')';
      }
      console.log(msg);
    },

    // WebSocket disconnected
    subscribeDisconnected: function() {
      console.log('Subscribe disconnected');
    },

    subscribePing: function() {
      console.log('Subscribe ping');
      if ( this.get('pingTimer') )
      {
        Ember.run.cancel(this.get('pingTimer'));
      }

      this.set('pingTimer', Ember.run.later(this, function() {
        console.log('Subscribe missed 2 pings...');
        this.get('socket').connect();
      }, 11000));
    },

    hostChanged: function(change) {
      // If the host has a physicalHostId, ensure it is in the machine's hosts array.
      var host = change.data.resource;
      var machine = this.get('store').getById('machine', host.get('physicalHostId'));
      if ( machine )
      {
        machine.get('hosts').addObject(host);
      }
    },

    containerChanged: function(change) {
      this._includeChanged('host', 'instances', 'hosts', change.data.resource);
    },

    instanceChanged: function(change) {
      this._includeChanged('host', 'instances', 'hosts', change.data.resource);
    },

    ipAddressChanged: function(change) {
      this._includeChanged('host', 'ipAddresses', 'hosts', change.data.resource);
//      this._includeChanged('container', 'container', 'ipAddresses', 'containers', change.data.resource);
    },

    loadBalancerTargetChanged: function(change) {
      this._includeChanged('loadBalancer', 'loadBalancerTargets', 'loadBalancerId', change.data.resource);
    },

    loadBalancerConfigChanged: function(change) {
      this._includeChanged('loadBalancer', 'loadBalancerListeners', 'loadBalancerListeners', change.data.resource);
    },

    loadBalancerChanged: function(change) {
      var balancer = change.data.resource;
      var config = balancer.get('loadBalancerConfig');
      var balancers = config.get('loadBalancers');
      if ( !balancers )
      {
        balancers = [];
        config.set('loadBalancers',balancers);
      }

      if ( config.get('state') === 'removed' )
      {
        balancers.removeObject(balancer);
      }
      else
      {
        balancers.addObject(balancer);
      }
    },

    mountChanged: function(change) {
      var mount = change.data.resource;
      var volume = this.get('store').getById('volume', mount.get('volumeId'));
      if ( volume )
      {
        var mounts = volume.get('mounts');
        if ( !Ember.isArray(mounts) )
        {
          mounts = [];
          volume.set('mounts',mounts);
        }

        var existingMount = mounts.filterBy('id', mount.get('id')).get('firstObject');
        if ( existingMount )
        {
          existingMount.setProperties(mount);
        }
        else
        {
          mounts.pushObject(mount);
        }
      }
    },

    registryCredentialChanged: function(change) {
      this._includeChanged('registry', 'credentials', 'registryId', change.data.resource);
    },

    loadBalancerServiceChanged: function(change) {
      this._includeChanged('environment', 'services', 'environmentId', change.data.resource);
    },

    dnsServiceChanged: function(change) {
      this._includeChanged('environment', 'services', 'environmentId', change.data.resource);
    },

    externalServiceChanged: function(change) {
      this._includeChanged('environment', 'services', 'environmentId', change.data.resource);
    },

    serviceChanged: function(change) {
      this._includeChanged('environment', 'services', 'environmentId', change.data.resource);
    },
  },

  enter: function() {
    var store = this.get('store');
    var boundTypeify = store._typeify.bind(store);

    var url = "ws://"+window.location.host + this.get('app.wsEndpoint');
    var session = this.get('session');

    var projectId = session.get(C.SESSION.PROJECT);
    if ( projectId )
    {
      url = Util.addQueryParam(url, 'projectId', projectId);
    }

    var socket = Socket.create({
      url: url
    });

    socket.on('message', (event) => {
      var d = JSON.parse(event.data, boundTypeify);
      //this._trySend('subscribeMessage',d);

      var str = d.name;
      if ( d.resourceType )
      {
        str += ' ' + d.resourceType;

        if ( d.resourceId )
        {
          str += ' ' + d.resourceId;
        }
      }

      var action;
      if ( d.name === 'resource.change' )
      {
        action = d.resourceType+'Changed';
      }
      else if ( d.name === 'ping' )
      {
        action = 'subscribePing';
      }

      if ( action )
      {
        this._trySend(action,d);
      }
    });

    socket.on('connected', (tries, after) => {
      this._trySend('subscribeConnected', tries, after);
    });

    socket.on('disconnected', () => {
      this._trySend('subscribeDisconnected', this.get('tries'));
    });

    this.set('socket', socket);
    socket.connect();
  },

  exit: function() {
    var socket = this.get('socket');
    if ( socket )
    {
      socket.disconnect();
    }

    // Forget all the things
    this.get('store').reset();
  },

  _trySend: function(/*arguments*/) {
    try
    {
      this.send.apply(this,arguments);
    }
    catch (err)
    {
      if ( err instanceof Ember.Error && err.message.indexOf('Nothing handled the action') === 0 )
      {
        // Don't care
      }
      else
      {
        throw err;
      }
    }
  },


  // Update the `?include=`-ed arrays of a host,
  // e.g. when an instance changes:
  //   Update the destProperty='instances' array on all models of type resourceName='hosts'.
  //   to match the list in the the 'changed' resource's expectedProperty='hosts'
  // _includeChanged(       'host',       'hosts',        'instances', 'hosts',          instance)
  _includeChanged: function(resourceName, destProperty, expectedProperty, changed) {
    if (!changed)
    {
      return;
    }

    var changedId = changed.get('id');
    var store = this.get('store');

    //console.log('Include changed',resourceName,destProperty,expectedProperty,changedId);

    // All the resources
    var all = store.all(resourceName);

    // IDs the resource should be on
    var expectedIds = [];
    var expected = changed.get(expectedProperty)||[];
    if ( !Ember.isArray(expected) )
    {
      expected = [expected];
    }

    if ( changed.get('state') !== 'purged' )
    {
      expectedIds = expected.map(function(item) {
        if ( typeof item === 'object' )
        {
          return item.get('id');
        }
        else
        {
          return item;
        }
      });
    }

    // IDs it is currently on
    var curIds = [];
    all.forEach(function(item) {
      var existing = (item.get(destProperty)||[]).filterBy('id', changedId);
      if ( existing.length )
      {
        curIds.push(item.get('id'));
      }
    });

    // Remove from resources the changed shouldn't be on
    var remove = Util.arrayDiff(curIds, expectedIds);
    remove.forEach((id) => {
      //console.log('Remove',id);
      store.find(resourceName, id).then((item) => {
        var list = item.get(destProperty);
        if ( list )
        {
          //console.log('Removing',changedId,'from',item.get('id'));
          list.removeObjects(list.filterBy('id', changedId));
        }
      }).catch(() => {});
    });

    // Add or update resources the changed should be on
    expectedIds.forEach((id) => {
      //console.log('Expect',id);
      store.find(resourceName, id).then((item) => {
        var list = item.get(destProperty);
        if ( !list )
        {
          list = [];
          //console.log('Adding empty to',item.get('id'), destProperty);
          item.set(destProperty, list);
        }

        var existing = list.filterBy('id', changedId);
        if ( existing.length === 0)
        {
          //console.log('Adding',changedId,'to',item.get('id'), destProperty);
          list.pushObject(changed);
        }
      }).catch(() => {});
    });
  },
});
