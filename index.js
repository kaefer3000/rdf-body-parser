var Promise = require('bluebird')
var bodyParser = require('body-parser')
var rdf = require('rdf-ext')
var formats = require('rdf-formats-common')()
var url = require('url');

function init (options) {
  options = options || {}

  // default options
  options.bodyParser = options.bodyParser || bodyParser.text({type: '*/*'})
  options.formats = options.formats || formats

  // .sendGraph function
  var sendGraph = function (graph, mediaType) {
    var res = this

    // mediaType and defaultMediaType are interpreted as server preference about the
    // representation format. They differ in the occasions when they can be set when
    // implementing a server.
    //
    // mediaType can be set when calling sendGraph()
    // defaultMediaType can be set when this body parser is attached to an express app
    // mediaType overrides defaultMediaType

    // the list() method called below does not care about order when composing the list
    var serializerListOrderedByPreference = options.formats.serializers.list()

    if (!mediaType) {
      mediaType = options.defaultMediaType
    }
    if (mediaType) {
      // processing the server preference
      if (!options.formats.serializers[mediaType]) {
        // There is no serialiser for the server preference, ie. the server fails
        res.status(500)

        return Promise.promisify(res.end, {context: res})()
      }

      // req.accepts() requires a list of serialisers ordered by server preference,
      // so to order the list according to our preference, we have to remove our
      // preferred media type and re-add it at the first position
      serializerListOrderedByPreference = [mediaType].concat(serializerListOrderedByPreference.filter(
        function(mt) { return mt !== mediaType }))
    }

    // req.accepts() takes a list of media types ordered by server preference and does
    // the content negotiation. Returns undefined if no agreement can be found between
    // client and server preferences.
    mediaType = res.req.accepts(serializerListOrderedByPreference)

    if (!mediaType || typeof mediaType !== 'string') {
      res.status(406)
      return Promise.promisify(res.end, {context: res})()
    }

    if (mediaType == 'application/n-triples') {
      // N-Triples does not support relative URIs, hence we resolve all URIs

      var returnGraph = rdf.createGraph()
      var resolveSubject = false, resolvePredicate = false, resolveObject = false;
      var resolvedTriple

      graph.forEach(function(triple) {
          resolveSubject = resolvePredicate = resolveObject = false;

          // is there something to resolve, if so, at which position of the triple?
          if (triple.subject.interfaceName === 'NamedNode' && !triple.subject.nominalValue.match(/^https?:\/\//i))
            resolveSubject = true
          if (triple.predicate.interfaceName === 'NamedNode' && !triple.predicate.nominalValue.match(/^https?:\/\//i))
            resolvePredicate = true
          if (triple.object.interfaceName === 'NamedNode' && !triple.object.nominalValue.match(/^https?:\/\//i))
            resolveObject = true

          // then resolve!
          if (resolveSubject || resolvePredicate || resolveObject) {
            returnTriple = new rdf.Triple(triple.subject, triple.predicate, triple.object)

            if (resolveSubject)
              returnTriple.subject = new rdf.NamedNode(url.resolve(res.req.protocol + '://' + res.req.get('host') + res.req.originalUrl, triple.subject.nominalValue))
            if (resolvePredicate)
              returnTriple.predicate = new rdf.NamedNode(url.resolve(res.req.protocol + '://' + res.req.get('host') + res.req.originalUrl, triple.predicate.nominalValue))
            if (resolveObject)
              returnTriple.object = new rdf.NamedNode(url.resolve(res.req.protocol + '://' + res.req.get('host') + res.req.originalUrl, triple.object.nominalValue))

            // the triple for the graph is the created triple
            triple = returnTriple
          }
          // and add the triple to the graph
          returnGraph.add(triple)
        });
      // the graph to be further processed is the created graph
      graph = returnGraph
    }

    return options.formats.serializers.serialize(mediaType, graph).then(function (serialized) {
      res.setHeader('Content-Type', mediaType)

      return Promise.promisify(res.end, {context: res})(serialized)
    })
  }

  // middleware
  return function (req, res, next) {
    options.bodyParser(req, res, function () {
      res.sendGraph = sendGraph

      var mediaType = 'content-type' in req.headers ? req.headers['content-type'] : options.defaultMediaType

      // empty body
      if (typeof req.body === 'object' && Object.keys(req.body).length === 0) {
        return next()
      }

      options.formats.parsers.parse(mediaType, req.body).then(function (graph) {
        req.graph = graph

        next()
      }).catch(function (error) {
        next(error)
      })
    })
  }
}

init.attach = function (req, res, options) {
  if (req.graph && res.sendGraph) {
    return Promise.resolve()
  }

  return Promise.promisify(init(options))(req, res)
}

module.exports = init
