// TODO:
//  * only show images within the last 6 hours (?)
//  * Fix markers
//     * Try using pins
//     * Maybe use herenow count?
//  * Maybe add mini-map showing larger overview?
//  * Parameterize refresh rate.


// common objects & functions

// Pads the string on the left.
String.prototype.lpad = function(padString, length) {
  var str = this;
  while (str.length < length)
  str = padString + str;
  return str;
}
 
// Pads the string on the right.
String.prototype.rpad = function(padString, length) {
  var str = this;
  while (str.length < length)
  str = str + padString;
  return str;
}

function LL(lat, lng) {
  this.lat = lat;
  this.lng = lng;

  this.toString = function() {
    return this.lat + ',' + this.lng;
  }

  // return the distance in degrees.
  this.distance = function(other) {
    var latD = other.lat - this.lat;
    var lngD = other.lng - this.lng;
    return Math.sqrt(latD*latD + lngD*lngD);
  }
}

function debug(obj) {
  console.log(new Date().toUTCString() + ": " + obj);
}

function defined(x) { return (typeof x !== 'undefined') }

function errorFunc(data, textStatus, errorThrown) {
  debug('Error: ' + JSON.stringify(data));
}

var mode = 'wide';

// Adjust the stylesheet for narrow browsers.
function adjustStyle(width, height) {
  if (height > width) {
    debug('[' + width + 'x' + height + ']: Using narrow stylesheet');
    $('#sized-stylesheet').attr('href', 'lobby-narrow.css');
    document.getElementById('info').style.left = ((width - 750) / 2) + 'px';
    mode = 'narrow';
  } else {
    debug('[' + width + 'x' + height + ']: Using wide stylesheet');
    $('#sized-stylesheet').attr('href', 'lobby-wide.css');
    mode = 'wide';
  }
}

$(function() {
  adjustStyle($(this).width(), $(this).height());
  $(window).resize(function() {
    adjustStyle($(this).width(), $(this).height());
  });
});

// Show/hide the controls on 'c'
$(document).bind('keydown', function(e) {
  if (e.which == 191) {
    var elt = document.getElementById('controls');
    if (elt.style.display == 'none') {
      elt.style.display = '';
    } else {
      elt.style.display = 'none';
    }
  }
});

var token = null;
var apihost = null;
var webhost = null;

function getToken() {
  var prod = true;
  if (prod) {
    var client_id = 'DYELAG11XFO0GOVL3JRI0PMAF2RBJN1YZ0BR2FASJYLJIFKG'; //prod
    apihost = 'api.foursquare.com';
    webhost = 'foursquare.com';
  } else {
    var client_id = 'DYELAG11XFO0GOVL3JRI0PMAF2RBJN1YZ0BR2FASJYLJIFKG'; //prod
    apihost = 'api-ahogue-staging.foursquare.com';
    webhost = 'ahogue-staging.foursquare.com';
  }
  var callback_url = 'http://secondthought.org/fsq/lobby/';

  /* Attempt to retrieve access token from URL. */
  if ($.bbq.getState('access_token')) {
    token = $.bbq.getState('access_token');
    $.bbq.pushState({access_token: token}, 2);
  } else {
    /* Redirect for foursquare authentication. */
    var url = 'https://' + webhost + '/oauth2/authenticate?client_id=' + client_id +
      '&response_type=token&redirect_uri=' + callback_url;
    window.location.href = url;
  }
}

// The current set of trending venues, and the index we're currently showing.
var venues;
var venueIndex;
// The GMap.
var map;
// The current marker and info about it.
var marker;
var markerPin;
var markerPinImage = new google.maps.MarkerImage('pin-blue-transparent.png',
                                                 new google.maps.Size(44, 71),
                                                 new google.maps.Point(0,0),
                                                 new google.maps.Point(0, 22));
var latlng;

// The timeouts for refreshing the map.
var LOAD_TRENDING_INTERVAL = 1000*60*30;  // Reload the trending data every 30 minutes.
var loadTrendingTimeout;
var switchVenueTimeout;

function load() {
  getToken();
  loadMap();
  loadTrending(switchVenue);
}

function loadMap() {
  map = new google.maps.Map(document.getElementById('map_canvas'), {
    zoom: 2,
    center: new google.maps.LatLng(40.7, -74),
    mapTypeId: google.maps.MapTypeId.SATELLITE,
    disableDefaultUI: true
  });
}

function loadTrending(closure) {
  debug('Loading new trending data...');
  if (token == null) { return; }
  var url = 'https://' + apihost + '/v2/private/worldwidetrending' +
    '?oauth_token=' + token +
    '&includeTweets=foursquare' +
    '&limit=' + document.f.l.value +
    '&v=20120315';
  $.ajax({
    url: url,
    dataType: 'json',
    type: 'GET',
    error: errorFunc,
    success: function(data) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('info').style.display = '';

      venues = shuffle(data['response']['venues']);
      debug('...done, got ' + venues.length + ' trending venues');
      for (var ii = 0; ii < data['response']['venues'].length; ++ii) {
        var venue = data['response']['venues'][ii]['venue'];
        debug('#' + (ii+1).toString().lpad('0', 2) + ': ' + venue['name'].rpad(' ', 40) +
              ' (' + venue['hereNow']['count'].toString().lpad(' ', 3) + ' here), ' +
              makeAddress(venue['location']));
      }
      venueIndex = 0;
      closure();
      loadTrendingTimeout = setTimeout("loadTrending(function() {})", LOAD_TRENDING_INTERVAL);
    }
  });
}

function shuffle(a) {
  for (var ii = 0; ii < a.length; ++ii) {
    var idx = Math.floor(Math.random() * a.length);
    var tmp = a[idx];
    a[idx] = a[ii];
    a[ii] = tmp;
  }
  return a;
}

function switchVenue() {
  var idx = (venueIndex++) % venues.length;
  var venueAndTweets = venues[idx];
  var venue = venueAndTweets['venue'];
  var events = venueAndTweets['events'];
  var tweets = venueAndTweets['tweets'];
  latlng = new google.maps.LatLng(venue['location']['lat'], venue['location']['lng']); 

  // First remove the old marker
  if (defined(marker)) marker.setMap(null);
  if (defined(markerPin)) markerPin.setMap(null);
  markerPin = new google.maps.Marker({
    position: latlng,
    map: map,
    icon: markerPinImage
  });
  marker = new google.maps.Marker({
    position: latlng,
    map: map,
    title: venue['name'],
    icon: new google.maps.MarkerImage(getIcon(venue),
                                      new google.maps.Size(32,32),
                                      new google.maps.Point(0,0),
                                      new google.maps.Point(-6,0))
  });

  makeInfoContent(venue, events, tweets);
  getPhotos(venue['id'], function(photos) {
    if (photos.length < 1) return;
    var photo = photos[0];
    var url = photo['url'];
    for (var ii = 0; ii < photo['sizes']['items'].length; ++ii) {
      if (photo['sizes']['items'][ii]['width'] == 300) {
        url = photo['sizes']['items'][ii]['url'];
      }
    }
    document.getElementById('photo').innerHTML = '<img class=photo src=' +
      url + '></div>';
  });

  map.setCenter(latlng);
  map.setZoom(15);

  // Adjust the marker's position depending on where the infobox is,
  // so the marker looks like it's in the center of the map.
  var zoomCmd = "map.setCenter(latlng);map.setZoom(17);";
  if (mode == 'wide') {
    map.panBy(175, 0);
    zoomCmd += "map.panBy(175,0);";
  } else {
    map.panBy(0, 170);
    zoomCmd += "map.panBy(0,170);";
  }

  var interval = parseInt(document.f.r.value) * 1000;
  setTimeout(zoomCmd, 2 * interval / 3);
  switchVenueTimeout = setTimeout("switchVenue()", interval);
}

function cleanTweet(tweet) {
  var stripped = tweet.replace(/\s*http:\/\/t.co\/[\w]+/, "");
  stripped = stripped.replace(/\(\@ [^\)]+\)/, "");
  stripped = stripped.replace(/\[pic\]/, "");
  if (stripped.length > 105) {
    stripped = stripped.substr(0, 105) + '...';
  }
  return stripped;
}

function makeInfoContent(venue, events, tweets) {

  var eventHTML = '';
  if (defined(events) && defined(events['items']) && events['items'].length > 0) {
    var eventName = events['items'][0]['name'];
    eventHTML = '<div class=event>' + eventName + '</div>'
  }

  var tweetHTML = '';
  if (defined(tweets) && defined(tweets['items'])) {
    for (var ii = 0; ii < tweets['items'].length && ii < 3; ++ii) {
      var tweet = tweets['items'][ii];
      tweetHTML += '<div class=tweet>' +
        '<span class=tweet_avatar>' +
        '<img height=48 src="' + tweet['user']['profileImage'] + '" ' + 'width=48 /></span>' +
        cleanTweet(tweet['text']) +
        '<span class="tweet_author">&nbsp;&mdash;&nbsp;@' + tweet['user']['screenName'] + '</span></div>';
    }
  }
  
  document.getElementById('venue').innerHTML = '<table width=100%>' +
    '<tr><td class=categoryIcon rowspan=2><img src="' + getIcon(venue) + '"></td>' +
    '<td><div class=venueName><a href=http://foursquare.com/v/' + venue['id'] + '>' +
    venue['name'] + '</a></div>' +
    eventHTML + '</td>' +
    '<td class=hereNow><img class=hereNowImg src=herenow.png>' +
    '<span class=hereNowNum>' + venue['hereNow']['count'] + '</span>&nbsp;people</td></tr>' +
    '<tr><td colspan=2 class=venueLoc>' + makeAddress(venue['location']) + '</td></tr></table>';

  document.getElementById('tweets').innerHTML = tweetHTML;
}

function getIcon(venue) {
  if (venue['categories'].length > 0) {
    return venue['categories'][0]['icon']['prefix'] + '32.png';
  } else {
    return 'http://foursquare.com/img/categories/none_32.png';
  }
}

function makeAddress(location) {
  var out = '';
  if (defined(location)) {
    if (defined(location['address'])) {
      out += location['address'];
      if (defined(location['crossStreet'])) {
        if (location['crossStreet'].indexOf('btwn') != 0) {
          out += ' (at ';
        } else {
          out += ' (';
        }
        out += location['crossStreet'] + ')';
      }
      out += ' ';
    }
    if (defined(location['city'])) {
      out += location['city'];
    }
    if (defined(location['state'])) {
      if (defined(location['city'])) {
        out += ', ';
      }
      out += location['state'];
    }
    if (defined(location['country'])) {
      if (defined(location['address']) || defined(location['city']) || defined(location['state'])) {
        out += ', ' + location['country'];
      }
    }
  }

  return out;        
}

function getPhotos(venueId, closure) {
  var url = 'https://' + apihost + '/v2/venues/' +
    venueId + '/photos?group=venue&limit=1' +
    '&oauth_token=' + token;
  $.ajax({
    url: url,
    dataType: 'json',
    type: 'GET',
    error: errorFunc,
    success: function(data) {
      if (defined(data['response']) &&
          defined(data['response']['photos']) &&
          defined(data['response']['photos']['items'])) {
        closure(data['response']['photos']['items']);
      }
    }
  });

}


