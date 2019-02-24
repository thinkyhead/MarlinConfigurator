/**
 * configurator.js
 *
 * Marlin Configuration Utility
 *    - Web form for entering configuration options
 *    - A reprap calculator to calculate movement values
 *    - Uses HTML5 to generate downloadables in Javascript
 *    - Reads and parses standard configuration files from local folders
 *
 * Supporting functions
 *    - Parser to read Marlin Configuration.h and Configuration_adv.h files
 *    - Utilities to replace values in configuration files
 */

$(function(){

"use strict";

/**
 * Github API useful GET paths`. (Start with "https://api.github.com/repos/:owner/:repo/")
 *
 *   contributors                               Get a list of contributors
 *   tags                                       Get a list of tags
 *   contents/[path]?ref=branch/tag/commit      Get the contents of a file
 */

//* GitHub: MarlinConfigurator
// Warning! Limited to 60 requests per hour!
var config_github_th = {
  type:  'github',
  host:  'https://api.github.com',
  owner: 'thinkyhead',
  repo:  'MarlinConfigurator',
  ref:   'master',
  path:  'src/config'
};
/**/

//* Github: Marlin
// Warning! Limited to 60 requests per hour!
var config_github_mf = {
  type:  'github',
  host:  'https://api.github.com',
  owner: 'MarlinFirmware',
  repo:  'Marlin',
  ref:   '1.1.x',
  path:  'Marlin'
};
/**/

//* Remote (Servers may need .htaccess here)
var config_remote = {
  type:  'remote',
  host:  'http://www.thinkyhead.com',
  path:  '_marlin/config/2.0.x'
};
/**/

//* Local
var config_local = {
  type:  'local',
  path:  'config/2.0.x'
};
/**/

var config = window.location.protocol == 'file:' ? config_remote : config_local;

function github_command(conf, command, path) {
  var req = conf.host+'/repos/'+conf.owner+'/'+conf.repo+'/'+command;
  if (path) req += '/' + path;
  return req;
}
function config_path(item) {
  var path = '', ref = '';
  switch(config.type) {
    case 'github':
      path = github_command(config, 'contents', config.path);
      if (config.ref !== undefined) ref = '?ref=' + config.ref;
      break;
    case 'remote':
      path = config.host + '/' + config.path;
      break;
    case 'local':
      path = config.path;
      break;
  }
  return path + '/' + item + ref;
}

// Extend builtins
String.prototype.lpad = function(len, chr) {
  if (chr === undefined) { chr = '&nbsp;'; }
  var s = this+'', need = len - s.length;
  if (need > 0) { s = new Array(need+1).join(chr) + s; }
  return s;
};

String.prototype.prePad = function(len, chr) { return len ? this.lpad(len, chr) : this; };
String.prototype.zeroPad = function(len)     { return this.prePad(len, '0'); };
String.prototype.toHTML = function()         { return jQuery('<div>').text(this).html(); };
String.prototype.regEsc = function()         { return this.replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&"); }
String.prototype.lineCount = function(ind)   { var len = (ind === undefined ? this : this.substr(0,ind*1)).split(/\r?\n|\r/).length; return len > 0 ? len - 1 : 0; };
String.prototype.line = function(num)        { var arr = this.split(/\r?\n|\r/); return num < arr.length ? arr[1*num] : ''; };
String.prototype.replaceLine = function(num,txt) { var arr = this.split(/\r?\n|\r/); if (num < arr.length) { arr[num] = txt; return arr.join('\n'); } else return this; }
String.prototype.toLabel = function()        { return this.replace(/[\[\]]/g, '').replace(/_/g, ' ').toTitleCase(); }
String.prototype.toTitleCase = function()    { return this.replace(/([A-Z])(\w+)/gi, function(m,p1,p2) { return p1.toUpperCase() + p2.toLowerCase(); }); }
Number.prototype.limit = function(m1, m2)  {
  if (m2 == null) return this > m1 ? m1 : this;
  return this < m1 ? m1 : this > m2 ? m2 : this;
};
Date.prototype.fileStamp = function(filename) {
  var fs = this.getFullYear()
    + ((this.getMonth()+1)+'').zeroPad(2)
    + (this.getDate()+'').zeroPad(2)
    + (this.getHours()+'').zeroPad(2)
    + (this.getMinutes()+'').zeroPad(2)
    + (this.getSeconds()+'').zeroPad(2);

  if (filename !== undefined)
    return filename.replace(/^(.+)(\.\w+)$/g, '$1-['+fs+']$2');

  return fs;
}

function isArray(v) { return Object.prototype.toString.call(v) == "[object Array]" }

/**
 * selectField.addOptions takes an array or keyed object
 */
$.fn.extend({
  addOptions: function(arrObj) {
    return this.each(function() {
      var sel = $(this);
      var isArr = isArray(arrObj);
      $.each(arrObj, function(k, v) {
        sel.append( $('<option>',{value:isArr?v:k}).text(v) );
      });
    });
  },
  noSelect: function() {
    return this
            .attr('unselectable', 'on')
            .css('user-select', 'none')
            .on('selectstart', false);
  },
  unblock: function(on) {
    on ? this.removeClass('blocked') : this.addClass('blocked');
    return this;
  }
});

// The app is a singleton
window.configuratorApp = (function(){

  // private variables and functions go here
  var self,
      pi2 = Math.PI * 2,
      has_boards = false, has_config = false, has_config_adv = false,
      boards_file = 'boards.h',
      config_file = 'Configuration.h',
      config_adv_file = 'Configuration_adv.h',
      $msgbox = $('#message'),
      $form = $('#config_form'),
      $tooltip = $('#tooltip'),
      $cfg = $('#config_text'), $adv = $('#config_adv_text'),
      $config = $cfg.find('pre'), $config_adv = $adv.find('pre'),
      config_file_list = [ boards_file, config_file, config_adv_file ],
      config_list = [ $config, $config_adv ],
      define_info = {},         // info for all defines, by name
      define_list = [[],[]],    // arrays with all define names
      define_occur = [{},{}],   // lines where defines occur in each file
      define_groups = [{},{}],  // similarly-named defines that group in the form
      define_section = {},      // the section of each define
      dependent_groups = {},    // lines that depend on set/unset options
      boards_list = {},         // all boards, for the MOTHERBOARD setting
      therms_list = {},         // thermistors, for the TEMP_SENSOR settings
      total_config_lines,       // total line counts
      total_config_adv_lines,
      hover_timer,              // for tooltips
      pulse_offset = 0;         // for error messages

  var LOG_NONE = 0,
      LOG_ECHO = 1,
      LOG_WARNING = 2,
      LOG_ERROR = 4,
      LOG_FUNC = 8,
      LOG_PARSE = 16,
      LOG_MORE = 32,
      LOG_OPTIONS = 64;

  // Return this anonymous object as configuratorApp
  return {
    // public data members
    logging: LOG_WARNING|LOG_ERROR,

    // public methods

    init: function() {
      self = this; // a 'this' for use when 'this' is something else

      // Set up the form, creating fields and fieldsets as-needed
      this.initConfigForm();

      // Make tabs for all the fieldsets
      this.makeTabsForFieldsets();

      // No selection on errors
      // $msgbox.noSelect();

      // Make a droppable file uploader, if possible
      var $uploader = $('#file-upload');
      var fileUploader = new BinaryFileUploader({
        element:    $uploader[0],
        onFileLoad: function(file) { self.handleFileLoad(file, $uploader); }
      });
      if (!fileUploader.hasFileUploaderSupport())
        this.setMessage("Your browser doesn't support the file reading API.", 'error');

      // Make the disclosure items work
      $('.disclose').click(function(){
        var $dis = $(this), $pre = $dis.nextAll('pre:first');
        var didAnim = function() {$dis.toggleClass('closed almost');};
        $dis.addClass('almost').hasClass('closed')
          ? $pre.slideDown(200, didAnim)
          : $pre.slideUp(200, didAnim);
      });

      // Adjust the form layout for the window size
      $(window).bind('scroll resize', this.adjustFormLayout).trigger('resize');

      // Read boards.h, Configuration.h, Configuration_adv.h
      var ajax_count = 0, success_count = 0;
      var loaded_items = {};
      var isGithub = config.type == 'github';
      var rateLimit = 0;
      $.each(config_file_list, function(i,fname){
        var url = config_path(fname);
        $.ajax({
          url: url,
          type: 'GET',
          dataType: isGithub ? 'jsonp' : undefined,
          async: true,
          cache: false,
          error: function(req, stat, err) {
            self.log(req, LOG_ERROR);
            if (req.status == 200) {
              if (typeof req.responseText === 'string') {
                var txt = req.responseText;
                loaded_items[fname] = function(){ self.fileLoaded(fname, txt, true); };
                success_count++;
                // self.setMessage('The request for "'+fname+'" may be malformed.', 'error');
              }
            }
            else {
              self.setRequestError(req.status ? req.status : '(Access-Control-Allow-Origin?)', url);
            }
          },
          success: function(txt) {
            if (isGithub && typeof txt.meta.status !== undefined && txt.meta.status != 200) {
              self.setRequestError(txt.meta.status, url);
            }
            else {
              // self.log(txt, LOG_ECHO);
              if (isGithub) {
                rateLimit = {
                  quota: 1 * txt.meta['X-RateLimit-Remaining'],
                  timeLeft: Math.floor(txt.meta['X-RateLimit-Reset'] - Date.now()/1000),
                };
              }
              loaded_items[fname] = function(){ self.fileLoaded(fname, isGithub ? decodeURIComponent(escape(atob(txt.data.content.replace(/\s/g, '')))) : txt, true); };
              success_count++;
            }
          },
          complete: function() {
            if (++ajax_count >= config_file_list.length) {
              // If not all files loaded set an error
              if (success_count < ajax_count)
                self.setMessage('Unable to load configurations. Try the upload field.', 'error');

              // Is the request near the rate limit? Set an error.
              var r;
              if (r = rateLimit) {
                if (r.quota < 20) {
                  self.setMessage(
                    'Approaching request limit ('
                      + r.quota + ' remaining.'
                      + ' Reset in ' + Math.floor(r.timeLeft/60) + ':' + (r.timeLeft%60+'').zeroPad(2) + ')',
                    'warning'
                  );
                }
              }
              // Post-process all the loaded files
              $.each(config_file_list, function(){ if (loaded_items[this]) loaded_items[this](); });
            }
          }
        });
      });
    },

    /**
     * Make a download link visible and active
     */
    activateDownloadLink: function(cindex) {
      var filename = config_file_list[cindex+1];
      var $c = config_list[cindex], txt = $c.text();
      $c.prevAll('.download:first')
        .unbind('mouseover click')
        .mouseover(function() {
          var d = new Date(), fn = d.fileStamp(filename);
          $(this).attr({ download:fn, href:'download:'+fn, title:'download:'+fn });
        })
        .click(function(){
          var $button = $(this);
          $(this).attr({ href:'data:text/plain;charset=utf-8,' + encodeURIComponent($c.text()) });
          setTimeout(function(){
            $button.attr({ href:$button.attr('title') });
          }, 100);
          return true;
        })
        .css({visibility:'visible'});
    },

    /**
     * Make the download-all link visible and active
     */
    activateDownloadAllLink: function() {
      $('.download-all')
        .unbind('mouseover click')
        .mouseover(function() {
          var d = new Date(), fn = d.fileStamp('MarlinConfig.zip');
          $(this).attr({ download:fn, href:'download:'+fn, title:'download:'+fn });
        })
        .click(function(){
          var zip = new JSZip(), $button = $(this);
          $.each(config_file_list.slice(1), function(i,v){ zip.file(v, config_list[i].text()); });

          // JSZip 3.x
          // var result = zip.generateAsync({type:'blob'}).then(
          //   function(blob){ saveAs(blob, $button.attr('download')); },
          //   function(err){ $button.addClass('err'); }
          // );

          // JSZip 2.x
          var zipped = zip.generate({type:'blob'});
          saveAs(zipped, $button.attr('download'));

          return false;
        })
        .css({visibility:'visible'});
    },

    /**
     * Init the boards array from a boards.h file
     */
    initBoardsFromText: function(txt) {
      boards_list = {};
      var r, findDef = new RegExp('[ \\t]*#define[ \\t]+(BOARD_[\\w_]+)[ \\t]+(\\d+)[ \\t]*(//[ \\t]*(.*))?', 'gm');
      while((r = findDef.exec(txt)) !== null)
        boards_list[r[1]] = r[2].prePad(3, '  ') + (r[4] !== undefined ? " — " + r[4].replace(/\).*/, ')') : '');
      this.log("Loaded boards:\n" + Object.keys(boards_list).join('\n'), LOG_ECHO);
      has_boards = true;
    },

    /**
     * Init the thermistors array from the Configuration.h file
     */
    initThermistorList: function(txt) {
      // Get all the thermistors and save them into an object
      var r, s, findDef = new RegExp('(//.*\n)+\\s+(#define[ \\t]+TEMP_SENSOR_0)', 'g');
      r = findDef.exec(txt);
      findDef = new RegExp('^//[ \\t]*([-\\d]+)[ \\t]+is[ \\t]+(.*)[ \\t]*$', 'gm');
      while((s = findDef.exec(r[0])) !== null) {
        therms_list[s[1]] = s[1].prePad(4, '  ') + " — " + s[2];
      }
    },

    /**
     * Get all the unique define names, building lists that will be used
     * when gathering info about each define.
     *
     * define_list[c][j]        : Define names in each config (in order of occurrence)
     * define_section[name]     : Section where define should appear in the form
     * define_occur[c][name][i] : Lines in each config where the same define occurs
     *   .cindex   Config file index
     *   .lineNum  Line number of the occurrence
     *   .line     The occurrence line
     */
    initDefineList: function(cindex) {
      this.log('>> initDefineList', LOG_FUNC);
      var section = 'hidden',
          leave_out_defines = ['CONFIGURATION_H', 'CONFIGURATION_H_VERSION', 'CONFIGURATION_ADV_H', 'CONFIGURATION_ADV_H_VERSION'],
          define_sect = {},
          occ_list = {},
          txt = config_list[cindex].text(),
          r, findDef = new RegExp('^.*(@section|#define)[ \\t]+(\\w+).*$', 'gm');
      // scan for sections and defines
      while((r = findDef.exec(txt)) !== null) {
        var name = r[2];
        if (r[1] == '@section') {
          section = name;
        }
        else if ($.inArray(name, leave_out_defines) < 0) {            // skip some defines
          var lineNum = txt.lineCount(r.index),                       // the line number
              inst = { cindex:cindex, lineNum:lineNum, line:r[0] },   // config, line, section/define
              in_sect = (name in define_sect);                        // already found (locally)?

          if (!in_sect) occ_list[name] = [ inst ];                    // no, first item in section

          if (!in_sect && !(name in define_section)) {                // first time in section, ever
            define_sect[name] = section; // new first-time define
          }
          else {
            occ_list[name].push(inst);                                // it's another occurrence
          }
        }
      }
      define_list[cindex] = Object.keys(define_sect);
      define_occur[cindex] = occ_list;
      $.extend(define_section, define_sect);
      this.log(define_list[cindex], LOG_PARSE);
      this.log(occ_list, LOG_PARSE);
      this.log(define_sect, LOG_PARSE);
      this.log('<< initDefineList', LOG_FUNC);
    },

    /**
     * Return a list of all unique define names
     */
    getUniqueDefineList: function() {
      var combined_list = {};
      $.each(define_list, function(i,list) {
        $.each(list, function(i,def) {
          if (combined_list[def] === undefined) combined_list[def] = { name:def, parent:'' };
        });
      });
      this.log(combined_list, LOG_WARNING);
      return combined_list;
    },

    /**
     * Find the defines in one of the configs that are just variants.
     * Group them together for form-building and other uses.
     *
     * define_groups[c][name]
     *   .pattern regexp matching items in the group
     *   .title   title substitution
     *   .count   number of items in the group
     */
    refreshDefineGroups: function(cindex) {
      this.log('>> refreshDefineGroups', LOG_FUNC);
      var findDef = /^(|.*_)(([XYZE](MAX|MIN))|(E[0-3]|[XYZE01234])|MAX|MIN|(bed)?K[pid]|HOTEND|HPB|JAPAN|WESTERN|CYRILLIC|LEFT|RIGHT|BACK|FRONT|[XYZ]_POINT)(_.*|)$/i;
      var match_prev, patt, title, nameList, groups = {}, match_section;
      $.each(define_list[cindex], function(i, name) {
        if (match_prev) {
          if (match_prev.exec(name) && define_section[name] == match_section) {
            nameList.push(name);
          }
          else {
            if (nameList.length > 1) {
              $.each(nameList, function(i,n){
                groups[n] = {
                  pattern: patt,
                  title: title,
                  count: nameList.length
                };
              });
            }
            match_prev = null;
          }
        }
        if (!match_prev) {
          var r = findDef.exec(name);
          if (r != null) {
            title = '';
            switch(r[2].toUpperCase()) {
              case '0':
                patt = '([0123])';
                title = 'N';
                break;
              case 'X':
                patt = '([XYZE])';
                title = 'AXIS';
                break;
              case 'E0':
                patt = 'E([0-3])';
                title = 'E';
                break;
              case 'BEDKP':
                patt = 'bed(K[pid])';
                title = 'BED_PID';
                break;
              case 'KP':
                patt = '(K[pid])';
                title = 'PID';
                break;
              case 'LEFT':
              case 'RIGHT':
              case 'BACK':
              case 'FRONT':
                patt = '([LRBF])(EFT|IGHT|ACK|RONT)';
                break;
              case 'MAX':
              case 'MIN':
                patt = '(MAX|MIN)';
                break;
              case 'HOTEND':
              case 'HPB':
                patt = '(HOTEND|HPB)';
                break;
              case 'JAPAN':
              case 'WESTERN':
              case 'CYRILLIC':
                patt = '(JAPAN|WESTERN|CYRILLIC)';
                break;
              case 'XMIN':
              case 'XMAX':
                patt = '([XYZ])'+r[4];
                title = 'XYZ_'+r[4];
                break;
              default:
                patt = null;
                break;
            }
            if (patt) {
              patt = '^' + r[1] + patt + r[7] + '$';
              title = r[1] + title + r[7];
              match_prev = new RegExp(patt, 'i');
              match_section = define_section[name];
              nameList = [ name ];
            }
          }
        }
      });
      define_groups[cindex] = groups;
      this.log(define_groups[cindex], LOG_PARSE);
      this.log('<< refreshDefineGroups', LOG_FUNC);
    },

    /**
     * Get all conditional blocks and their line ranges
     * and store them in the dependent_groups list.
     *
     * This data is gathered before configuration info
     * so that define_info can reference this data.
     *
     * dependent_groups[condition][i]
     *
     *   .cindex  config file index
     *   .start   starting line
     *   .end     ending line
     *
     */
    initDependentGroups: function() {
      this.log('>> initDependentGroups', LOG_FUNC);
      var findBlock = /^[ \t]*#(ifn?def|if|elif|else|endif)[ \t]*(.*)([ \t]*\/\/[^\n]+)?$/gm,
          leave_out_defines = ['CONFIGURATION_H', 'CONFIGURATION_H_VERSION', 'CONFIGURATION_ADV_H', 'CONFIGURATION_ADV_H_VERSION'];
      dependent_groups = {};
      $.each(config_list, function(i, $v) {
        var ifStack = [];
        var r, txt = $v.text();
        while((r = findBlock.exec(txt)) !== null) {
          var lineNum = txt.lineCount(r.index);
          var code = r[2].replace(/[ \t]*\/\/.*$/, '');
          switch(r[1]) {
            case 'if':
            case 'elif':
              // Convert preprocessor expressions into Javascript code
              // HAS_DRIVER(DRIVER) ......  self.hasDriver("DRIVER")
              // ENABLED(OPTION_NAME) ....  self.defineIsEnabled("OPTION_NAME")
              // DISABLED(OPTION_NAME) ... !self.defineIsEnabled("OPTION_NAME")
              // defined(OPTION_NAME) ....  self.defineIsEnabled("OPTION_NAME")
              // !defined(OPTION_NAME) ... !self.defineIsEnabled("OPTION_NAME")
              // OPTION_NAME .............  self.defineValue("OPTION_NAME")
              var code = code
                .replace(/ENABLED[ \t]*\(/g, 'defined(')
                .replace(/DISABLED[ \t]*\(/g, '!defined(')
                .replace(/defined[ \t]*\(?[ \t]*([A-Z][A-Z0-9_]+)[ \t]*\)?/g, '!self.defineIsEnabled("$1")')
                .replace(/AXIS_IS_TMC[ \t]*\([ \t]*([A-Z0-9]+)[ \t]*\)/g, 'self.axisIsTMC("$1")')
                .replace(/HAS_TRINAMIC([ \t]*\([ \t]*\)[ \t]*)?/g, 'self.hasTrinamic()')
                .replace(/AXIS_DRIVER_TYPE_([A-Z0-9]+)[ \t]*\([ \t]*([A-Z][A-Z0-9_]+)[ \t]*\)/g, 'self.axisIsDriver("$1","$2")')
                .replace(/HAS_DRIVER[ \t]*\([ \t]*([A-Z][A-Z0-9_]+)[ \t]*\)/g, 'self.hasDriver("$1")')
                .replace(/([A-Z][A-Z0-9_]{4,})/g, 'self.defineValue("$1")')
                .replace(/\("self\.defineValue\(("[A-Z][A-Z0-9_]+")\)"\)/g, '($1)');
              ifStack.push(['('+code+')', lineNum]);  // #if starts on next line
              self.log("push     if " + code, LOG_PARSE);
              break;
            case 'ifdef':
              if ($.inArray(code, leave_out_defines) < 0) {
                ifStack.push(['self.defineIsEnabled("' + code + '")', lineNum]);
                self.log("push  ifdef " + code, LOG_PARSE);
              }
              else {
                ifStack.push(0);
              }
              break;
            case 'ifndef':
              if ($.inArray(code, leave_out_defines) < 0) {
                ifStack.push(['!self.defineIsEnabled("' + code + '")', lineNum]);
                self.log("push ifndef " + code, LOG_PARSE);
              }
              else {
                ifStack.push(0);
              }
              break;
            case 'else':
            case 'endif':
              var c = ifStack.pop();
              if (c) {
                var cond = c[0], line = c[1];
                self.log("pop " + c[0], LOG_PARSE);
                if (dependent_groups[cond] === undefined) dependent_groups[cond] = [];
                dependent_groups[cond].push({cindex:i,start:line,end:lineNum});
                if (r[1] == 'else') {
                  // Reverse the condition
                  cond = (cond.indexOf('!') === 0) ? cond.substr(1) : ('!'+cond);
                  ifStack.push(['('+cond+')', lineNum]);
                  self.log("push     if " + cond, LOG_PARSE);
                }
              }
              else {
                if (r[1] == 'else') ifStack.push(0);
              }
              break;
          }
        }
      }); // text blobs loop
      this.log('<< initDependentGroups', LOG_FUNC);
    },

    /**
     * Init all the defineInfo structures after reload
     * The "enabled" field may need an update for newly-loaded dependencies
     */
    initDefineInfo: function() {
      this.log('>> initDefineInfo', LOG_FUNC);
      $.each(define_list, function(e,def_list){
        $.each(def_list, function(i, name) {
          define_info[name] = self.getDefineInfo(name, e);
        });
      });
      this.log('<< initDefineInfo', LOG_FUNC);
    },

    /**
     * Create fields for defines in a config that has none
     * Use define_groups data to group fields together
     */
    createFieldsForDefines: function(cindex) {
      this.log('>> createFieldsForDefines', LOG_FUNC);
      // var n = 0;
      var grouping = false, group = define_groups[cindex],
          g_pattern, g_regex, g_subitem, g_section, g_class,
          fail_list = [];
      $.each(define_list[cindex], function(i, name) {
        var section = define_section[name];

        self.log("section: " + section, LOG_PARSE);

        if (section != 'hidden' && !$('#'+name).length) {
          var inf = define_info[name];

          if (inf) {

            self.log(inf, LOG_PARSE);

            var label_text = name, sublabel;

            // Is this field in a sequence?
            // Then see if it's the second or after
            if (grouping) {
              if (name in group && g_pattern == group[name].pattern && g_section == section) {
                g_subitem = true;
                sublabel = g_regex.exec(name)[1];
              }
              else
                grouping = false;
            }
            // Start grouping?
            if (!grouping && name in group) {
              grouping = true;
              g_subitem = false;
              var grp = group[name];
              g_section = section;
              g_class = 'one_of_' + grp.count;
              g_pattern = grp.pattern;
              g_regex = new RegExp(g_pattern, 'i');
              label_text = grp.title;
              sublabel = g_regex.exec(name)[1];
            }

            self.log("eval (1): " + name + " ... " + inf.enabled, LOG_MORE);

            var $ff = $('#'+section), $newfield,
                avail = eval(inf.enabled);

            if (!(grouping && g_subitem)) {

              var $newlabel = $('<label>',{for:name,class:'added'}).text(label_text.toLabel());

              $newlabel.unblock(avail);

              // if (!(++n % 3))
                $newlabel.addClass('newline');

              $ff.append($newlabel);

            }

            // Multiple fields?
            if (inf.type == 'list') {
              for (var i=0; i<inf.size; i++) {
                var fieldname = i > 0 ? name+'-'+i : name;
                $newfield = $('<input>',{type:'text',size:6,maxlength:10,id:fieldname,name:fieldname,class:'subitem added',disabled:!avail}).unblock(avail);
                if (grouping) $newfield.addClass(g_class);
                $ff.append($newfield);
              }
            }
            else {
              // Items with options, either toggle or select
              // TODO: Radio buttons for other values
              if (inf.options !== undefined) {
                if (inf.type == 'toggle') {
                  $newfield = $('<input>',{type:'checkbox'});
                }
                else {
                  // Otherwise selectable
                  $newfield = $('<select>');
                }
                // ...Options added when field initialized
              }
              else {
                $newfield = inf.type == 'switch' ? $('<input>',{type:'checkbox'}) : $('<input>',{type:'text',size:10,maxlength:40});
              }
              $newfield.attr({id:name,name:name,class:'added',disabled:!avail}).unblock(avail);
              if (grouping) {
                $newfield.addClass(g_class);
                if (sublabel) {
                  $ff.append($('<label>',{class:'added sublabel',for:name}).text(sublabel.toTitleCase()).unblock(avail));
                }
              }
              // Add the new field to the form
              $ff.append($newfield);
            }
          }
          else
            fail_list.push(name);
        }
      });
      if (fail_list.length) this.log('Unable to parse:\n' + fail_list.join('\n'), LOG_ERROR);
      this.log('<< createFieldsForDefines', LOG_FUNC);
    },

    /**
     * Handle a file being dropped on the file field
     */
    handleFileLoad: function(txt, $uploader) {
      this.log('>> handleFileLoad', LOG_FUNC);
      txt += '';
      var filename = $uploader.val().replace(/(.*[\/\\])+/, '');
      if ($.inArray(filename, config_file_list) !== -1)
        this.fileLoaded(filename, txt);
      else
        this.setMessage("Can't parse '"+filename+"'!");
      this.log('<< handleFileLoad', LOG_FUNC);
    },

    /**
     * Process a file after it's been successfully loaded
     */
    fileLoaded: function(filename, txt, wait) {
      this.log('>> fileLoaded:'+filename, LOG_FUNC);
      var err, cindex;
      switch(filename) {
        case boards_file:
          this.initBoardsFromText(txt);
          $('#MOTHERBOARD').html('').addOptions(boards_list);
          if (has_config) this.initField('MOTHERBOARD');
          break;
        case config_file:
          if (has_boards) {
            $config.text(txt);
            total_config_lines = txt.lineCount();
            // this.initThermistorList(txt);
            if (!wait) cindex = 0;
            has_config = true;
            if (has_config_adv) {
              this.activateDownloadAllLink();
              if (wait) cindex = 2;
            }
          }
          else {
            err = boards_file;
          }
          break;
        case config_adv_file:
          if (has_config) {
            $config_adv.text(txt);
            total_config_adv_lines = txt.lineCount();
            if (!wait) cindex = 1;
            has_config_adv = true;
            if (has_config) {
              this.activateDownloadAllLink();
              if (wait) cindex = 2;
            }
          }
          else {
            err = config_file;
          }
          break;
      }
      // When a config file loads defines need update
      if (cindex != null) this.prepareConfigData(cindex);

      this.setMessage(err
        ? 'Please upload a "' + boards_file + '" file first!'
        : '"' + filename + '" loaded successfully.', err ? 'error' : 'message'
      );
      this.log('<< fileLoaded:'+filename, LOG_FUNC);
    },

    prepareConfigData: function(cindex) {
      this.log('>> prepareConfigData:'+cindex, LOG_FUNC);
      var inds = (cindex == 2) ? [ 0, 1 ] : [ cindex ];
      $.each(inds, function(i,e){
        // Purge old fields from the form, clear the define list
        self.purgeAddedFields(e);
        // Build the define_list
        self.initDefineList(e);
        // TODO: Find sequential names and group them
        //       Allows related settings to occupy one line in the form
        self.refreshDefineGroups(e);
      });
      // Build the dependent defines list
      this.initDependentGroups(); // all config text
      // Get define_info for all known defines
      this.initDefineInfo();      // all config text
      $.each(inds, function(i,e){
        // Create new fields
        self.createFieldsForDefines(e); // create new fields
        // Init the fields, set values, etc
        self.refreshConfigForm(e);
        self.activateDownloadLink(e);
      });
      this.log('<< prepareConfigData:'+cindex, LOG_FUNC);
    },

    /**
     * Add initial enhancements to the existing form
     */
    initConfigForm: function() {
      // Modify form fields and make the form responsive.
      // As values change on the form, we could update the
      // contents of text areas containing the configs, for
      // example.

      // while(!$config_adv.text() == null) {}
      // while(!$config.text() == null) {}

      // Go through all form items with names
      $form.find('[name]').each(function() {
        // Set its id to its name
        var name = $(this).attr('name');
        $(this).attr({id: name});
        // Attach its label sibling
        var $label = $(this).prev('label');
        if ($label.length) $label.attr('for',name);
      });

      // Get all 'switchable' class items and add a checkbox
      // $form.find('.switchable').each(function(){
      //   $(this).after(
      //     $('<input>',{type:'checkbox',value:'1',class:'enabler added'})
      //       .prop('checked',true)
      //       .attr('id',this.id + '-switch')
      //       .change(self.handleSwitch)
      //   );
      // });

      // Add options to the popup menus
      // $('#SERIAL_PORT').addOptions([0,1,2,3,4,5,6,7]);
      // $('#BAUDRATE').addOptions([2400,9600,19200,38400,57600,115200,250000]);
      // $('#EXTRUDERS').addOptions([1,2,3,4]);
      // $('#POWER_SUPPLY').addOptions({'1':'ATX','2':'Xbox 360'});

      // Replace the Serial popup menu with a stepper control
      /*
      $('#serial_stepper').jstepper({
        min: 0,
        max: 3,
        val: $('#SERIAL_PORT').val(),
        arrowWidth: '18px',
        arrowHeight: '15px',
        color: '#FFF',
        acolor: '#F70',
        hcolor: '#FF0',
        id: 'select-me',
        textStyle: {width:'1.5em',fontSize:'120%',textAlign:'center'},
        onChange: function(v) { $('#SERIAL_PORT').val(v).trigger('change'); }
      });
      */
    },

    /**
     * Make tabs to switch between fieldsets
     */
    makeTabsForFieldsets: function() {
      // Make tabs for the fieldsets
      var $fset = $form.find('fieldset'),
          $tabs = $('<ul>',{class:'tabs'}),
          ind = 1;
      $fset.each(function(){
        var tabID = 'TAB'+ind;
        $(this).addClass(tabID);
        var $leg = $(this).find('legend');
        var $link = $('<a>',{href:'#'+ind,id:tabID}).text($leg.text());
        $tabs.append($('<li>').append($link));
        $link.click(function(e){
          e.preventDefault;
          var ind = this.id;
          $tabs.find('.active').removeClass('active');
          $(this).addClass('active');
          $fset.hide();
          $fset.filter('.'+this.id).show();
          return false;
        });
        ind++;
      });
      $('#tabs').html('').append($tabs);
      $('<br>',{class:'clear'}).appendTo('#tabs');
      $tabs.find('a:first').trigger('click');
    },

    /**
     * Update all fields on the form after loading a configuration
     */
    refreshConfigForm: function(cindex) {

      /**
       * Any manually-created form elements will remain
       * where they are. Unknown defines (currently most)
       * are added to tabs based on section
       *
       * Specific exceptions can be managed by applying
       * classes to the associated form fields.
       * Sorting and arrangement can come from an included
       * Javascript file that describes the configuration
       * in JSON, or using information added to the config
       * files.
       *
       */

      // Refresh the motherboard menu with new options
      $('#MOTHERBOARD').html('').addOptions(boards_list);

      // Init all existing fields, getting define info for those that need it
      // refreshing the options and updating their current values
      $.each(define_list[cindex], function(i, name) {
        if ($('#'+name).length) {
          self.initField(name);
          self.initFieldValue(name);
        }
        else
          self.log(name + " is not on the page yet.", LOG_ERROR);
      });

      // Set enabled state based on dependencies
      // this.enableForDependentConditions();
    },

    /**
     * Enable / disable fields in dependent groups
     * based on their dependencies.
     */
    refreshDependentFields: function() {
      this.log('>> refreshDependentFields', LOG_FUNC);
      $.each(define_list, function(e,def_list){
        $.each(def_list, function(i, name) {
          var inf = define_info[name];
          if (inf && inf.enabled != 'true') {
            self.log("eval (2): " + inf.enabled, LOG_MORE);
            var $elm = $('#'+name), ena = eval(inf.enabled);
            var isEnabled = (inf.type == 'switch') || self.defineIsEnabled(name);
            $('#'+name+'-switch').attr('disabled', !ena);
            $elm.attr('disabled', !(ena && isEnabled)).unblock(ena);
            $('label[for="'+name+'"]').unblock(ena);
          }
        });
      });
      this.log('<< refreshDependentFields', LOG_FUNC);
    },

    /**
     * Make a field responsive, tooltip its label(s), add enabler if needed
     */
    initField: function(name) {
      this.log('>> initField:'+name, LOG_FUNC);
      var $elm = $('#'+name), inf = define_info[name];
      $elm[0].defineInfo = inf;

      // Create a tooltip on the label if there is one
      if (inf.tooltip) {
        // label for the item
        var $tipme = $('label[for="'+name+'"]');
        if ($tipme.length) {
          $tipme.unbind('mouseenter mouseleave');
          $tipme.hover(
            function() {
              if ($('#tipson input').prop('checked')) {
                var pos = $tipme.position(), px = $tipme.width()/2;
                $tooltip.html(inf.tooltip)
                  .append('<span>')
                  .css({bottom:($tooltip.parent().outerHeight()-pos.top+10)+'px',left:(pos.left+px)+'px'})
                  .show();
                if (hover_timer) {
                  clearTimeout(hover_timer);
                  hover_timer = null;
                }
              }
            },
            function() {
              hover_timer = setTimeout(function(){
                hover_timer = null;
                $tooltip.fadeOut(400);
              }, 400);
            }
          );
        }
      }

      // Make the element(s) respond to events
      if (inf.type == 'list') {
        // Multiple fields need to respond
        for (var i=0; i<inf.size; i++) {
          if (i > 0) $elm = $('#'+name+'-'+i);
          $elm.unbind('input');
          $elm.on('input', this.handleChange);
        }
      }
      else {
        var elmtype = $elm.attr('type');
        // Set options on single fields if there are any
        if (inf.options !== undefined && elmtype === undefined)
          $elm.html('').addOptions(inf.options);
        $elm.unbind('input change');
        $elm.on(elmtype == 'text' ? 'input' : 'change', this.handleChange);
      }

      // Add an enabler checkbox if it needs one
      if (inf.switchable && $('#'+name+'-switch').length == 0) {
        // $elm = the last element added
        $elm.after(
          $('<input>',{type:'checkbox',value:'1',class:'enabler added'})
            .prop('checked',self.defineIsEnabled(name))
            .attr({id: name+'-switch'})
            .change(self.handleSwitch)
        );
      }

      this.log('<< initField:' + name, LOG_FUNC);
    },

    /**
     * Handle any value field being changed
     * this = the field
     */
    handleChange: function() {
      self.updateDefineFromField(this.id);
      self.refreshDependentFields();
    },

    /**
     * Handle a switch checkbox being changed
     * this = the switch checkbox
     */
    handleSwitch: function() {
      var $elm = $(this),
          name = $elm[0].id.replace(/-.+/,''),
          inf = define_info[name],
          on = $elm.prop('checked') || false;

      self.setDefineEnabled(name, on);

      if (inf.type == 'list') {
        // Multiple fields?
        for (var i=0; i<inf.size; i++) {
          $('#'+name+(i?'-'+i:'')).attr('disabled', !on);
        }
      }
      else {
        $elm.prev().attr('disabled', !on);
      }
    },

    /**
     * CONFIGURATION CONDITION
     * The given axis has the given driver type
     */
    axisIsDriver: function(axis, driver_type) {
      var def = axis + '_DRIVER_TYPE',
          type = self.defineExists(def) && self.defineIsEnabled(def) ? self.defineValue(def) : 'A4988';
      return driver_type == type;
    },

    tmcDrivers: [ '2130', '2160', '2208', '2660', '5130', '5160' ],
    stepperAxes: [ 'X', 'X2', 'Y', 'Y2', 'Z', 'Z2', 'Z3', 'E0', 'E1', 'E2', 'E3', 'E4', 'E5' ],

    axisIsTMC: function(axis) {
      for (var d in self.tmcDrivers) if (self.axisIsDriver(axis, 'TMC' + d)) return true;
      return false;
    },

    hasDriver: function(driver_type) {
      for (var a in self.stepperAxes) if (self.axisIsDriver(a, driver_type)) return true;
      return false;
    },

    hasTrinamic: function() {
      for (var d in self.tmcDrivers) if (self.hasDriver('TMC' + d)) return true;
      return false;
    },

    /**
     * Get the current value of a #define
     */
    defineValue: function(name) {
      this.log('>> defineValue:'+name, LOG_FUNC);
      var inf = define_info[name];
      if (inf == null) return 'n/a';
      var r = inf.regex.exec(inf.line), val = r[inf.val_i];

      this.log(r, LOG_PARSE);

      this.log('<< defineValue:'+name, LOG_FUNC);

      return (inf.type == 'switch') ? (val === undefined || val.trim() != '//') : val;
    },

    defineExists: function(name) {
      return define_info[name] !== undefined;
    },

    /**
     * Get the current enabled state of a #define
     */
    defineIsEnabled: function(name) {
      this.log('>> defineIsEnabled:'+name, LOG_FUNC);
      var inf = define_info[name];
      if (inf == null) return false;
      var r = inf.regex.exec(inf.line);

      this.log(r, LOG_PARSE);

      var on = r[1] != null ? r[1].trim() != '//' : true;
      this.log(name + ' = ' + on, LOG_PARSE);

      this.log('<< defineIsEnabled:'+name, LOG_FUNC);

      return on;
    },

    /**
     * Set a #define enabled or disabled by altering the config text
     */
    setDefineEnabled: function(name, val) {
      this.log('setDefineEnabled:'+name, LOG_FUNC);
      var inf = define_info[name];
      if (inf) {
        var slash = val ? '' : '//';
        var newline = inf.line
          .replace(/^([ \t]*)(\/\/)([ \t]*)/, '$1$3')              // remove slashes
          .replace(inf.pre+inf.define, inf.pre+slash+inf.define);  // add them back
        this.setDefineLine(name, newline);
      }
    },

    /**
     * Update a #define (from the form) by altering the config text
     */
    updateDefineFromField: function(name) {
      this.log('>> updateDefineFromField:'+name, LOG_FUNC);

      // Drop the suffix on sub-fields
      name = name.replace(/-\d+$/, '');

      var $elm = $('#'+name), inf = define_info[name];
      if (inf == null) return;

      var isCheck = $elm.attr('type') == 'checkbox',
          val = isCheck ? $elm.prop('checked') : $elm.val().trim();

      var newline;
      switch(inf.type) {
        case 'switch':
          var slash = val ? '' : '//';
          newline = inf.line.replace(inf.repl, '$1'+slash+'$3');
          break;
        case 'list':
        case 'quoted':
        case 'plain':
          if (isCheck) this.setMessage(name + ' should not be a checkbox!', 'error');
        case 'toggle':
          if (isCheck) {
            val = val ? inf.options[1] : inf.options[0];
          }
          else {
            if (inf.type == 'list')
              for (var i=1; i<inf.size; i++) val += ', ' + $('#'+name+'-'+i).val().trim();
          }
          newline = inf.line.replace(inf.repl, '$1'+(''+val).replace('$','\\$')+'$3');
          break;
      }
      this.setDefineLine(name, newline);
      this.log('<< updateDefineFromField:'+name, LOG_FUNC);
    },

    /**
     * Set the define's line in the text to a new line,
     *   then update, highlight, and scroll to the line
     */
    setDefineLine: function(name, newline) {
      this.log('>> setDefineLine:'+name+'\n'+newline, LOG_FUNC);
      var inf = define_info[name];
      var $c = $(inf.field), txt = $c.text();

      var hilite_token = '[HIGHLIGHTER-TOKEN]';

      txt = txt.replaceLine(inf.lineNum, hilite_token + newline); // for override line and lineNum would be changed
      inf.line = newline;

      // Convert txt into HTML before storing
      var html = txt.toHTML().replace(hilite_token, '<span></span>');

      // Set the final text including the highlighter
      $c.html(html);

      // Scroll to reveal the define
      if ($c.is(':visible')) this.scrollToDefine(name);
      this.log('<< setDefineLine:'+name, LOG_FUNC);
    },

    /**
     * Scroll a pre box to reveal a #define
     */
    scrollToDefine: function(name, always) {
      this.log('>> scrollToDefine:'+name, LOG_FUNC);
      var inf = define_info[name], $c = $(inf.field);

      // Scroll to the altered text if it isn't visible
      var halfHeight = $c.height()/2, scrollHeight = $c.prop('scrollHeight'),
          lineHeight = scrollHeight/[total_config_lines, total_config_adv_lines][inf.cindex],
          textScrollY = (inf.lineNum * lineHeight - halfHeight).limit(0, scrollHeight - 1);

      if (always || Math.abs($c.prop('scrollTop') - textScrollY) > halfHeight) {
        $c.find('span').height(lineHeight);
        $c.animate({ scrollTop: textScrollY });
      }
      this.log('<< scrollToDefine:'+name, LOG_FUNC);
    },

    /**
     * Set a form field to the current #define value in the config text
     */
    initFieldValue: function(name) {
      var $elm = $('#'+name), inf = define_info[name],
          val = this.defineValue(name);

      this.log('>> initFieldValue:' + name + ' to ' + val, LOG_FUNC);

      // If the item is switchable then set enabled state too
      this.log("eval (3): " + inf.enabled, LOG_MORE);
      var $cb = $('#'+name+'-switch'), avail = eval(inf.enabled), on = true;
      if ($cb.length) {
        on = self.defineIsEnabled(name);
        $cb.prop('checked', on);
      }

      if (inf.type == 'list') {
        $.each(val.split(','),function(i,v){
          var $e = i > 0 ? $('#'+name+'-'+i) : $elm;
          $e.val(v.trim());
          $e.attr('disabled', !(on && avail)).unblock(avail);
        });
      }
      else {
        if (inf.type == 'toggle') val = val == inf.options[1];
        $elm.attr('type') == 'checkbox' ? $elm.prop('checked', val) : $elm.val(''+val);
        $elm.attr('disabled', !(on && avail)).unblock(avail); // enable/disable the form field (could also dim it)
      }

      $('label[for="'+name+'"]').unblock(avail);

      this.log('<< initFieldValue:' + name, LOG_FUNC);
    },

    /**
     * Purge added fields and all their define info
     */
    purgeAddedFields: function(cindex) {
      $.each(define_list[cindex], function(i, name){
        $('#'+name + ",[id^='"+name+"-'],label[for='"+name+"']").filter('.added').remove();
      });
      define_list[cindex] = [];
    },

    /**
     * Get information about a #define from configuration file text:
     *
     *   - Pre-examine the #define for its prefix, value position, suffix, etc.
     *   - Construct RegExp's for the #define to find and replace values.
     *   - Store the existing #define line as a fast key to finding it later.
     *   - Determine the line number of the #define
     *   - Gather nearby comments to be used as tooltips.
     *   - Look for JSON in nearby comments for use as select options.
     *
     *  define_info[name]
     *    .type    type of define: switch, list, quoted, plain, or toggle
     *    .size    the number of items in a "list" type
     *    .options select options, if any
     *    .cindex  config index
     *    .field   pre containing the config text (config_list[cindex][0])
     *    .line    the full line from the config text
     *    .pre     any text preceding #define
     *    .define  the "#define NAME" text (may have leading spaces)
     *    .post    the text following the "#define NAME val" part
     *    .regex   regexp to get the value from the line
     *    .repl    regexp to replace the value in the line
     *    .val_i   the value's index in the .regex result
     */
    getDefineInfo: function(name, cindex) {
      if (cindex === undefined) cindex = 0;
      this.log('>> getDefineInfo:'+name, LOG_FUNC);
      var $c = config_list[cindex], txt = $c.text(),
          info = { type:0, cindex:cindex, field:$c[0], val_i:2 }, post;

      // a switch line with no value
      var find = new RegExp('^([ \\t]*//)?[ \\t]*(#define[ \\t]+' + name + ')([ \\t]*(/[*/].*)?)$', 'm'),
          r = find.exec(txt);
      if (r !== null) {
        post = r[3] == null ? '' : r[3];
        $.extend(info, {
          type: 'switch',
          val_i: 1,
          regex: new RegExp('([ \\t]*//)?[ \\t]*(' + r[2].regEsc() + post.regEsc() + ')', 'm'),
          repl:  new RegExp('([ \\t]*)(\/\/)?[ \\t]*(' + r[2].regEsc() + post.regEsc() + ')', 'm')
        });
      }
      else {
        // a define with curly braces
        find = new RegExp('^(.*//)?(.*#define[ \\t]+' + name + '[ \\t]+)(\{[^\}]*\})([ \\t]*(/[*/].*)?)$', 'm');
        r = find.exec(txt);
        if (r !== null) {
          post = r[4] == null ? '' : r[4];
          $.extend(info, {
            type:  'list',
            size:  r[3].split(',').length,
            regex: new RegExp('([ \\t]*//)?[ \\t]*' + r[2].regEsc() + '\{([^\}]*)\}' + post.regEsc(), 'm'),
            repl:  new RegExp('(([ \\t]*//)?[ \\t]*' + r[2].regEsc() + '\{)[^\}]*(\}' + post.regEsc() + ')', 'm')
          });
        }
        else {
          // a define with quotes
          find = new RegExp('^(.*//)?(.*#define[ \\t]+' + name + '[ \\t]+)("[^"]*")([ \\t]*(/[*/].*)?)$', 'm');
          r = find.exec(txt);
          if (r !== null) {
            post = r[4] == null ? '' : r[4];
            $.extend(info, {
              type:  'quoted',
              regex: new RegExp('([ \\t]*//)?[ \\t]*' + r[2].regEsc() + '"([^"]*)"' + post.regEsc(), 'm'),
              repl:  new RegExp('(([ \\t]*//)?[ \\t]*' + r[2].regEsc() + '")[^"]*("' + post.regEsc() + ')', 'm')
            });
          }
          else {
            // a define with no quotes
            find = new RegExp('^([ \\t]*//)?([ \\t]*#define[ \\t]+' + name + '[ \\t]+)(\\S*)([ \\t]*(/[*/].*)?)$', 'm');
            r = find.exec(txt);
            if (r !== null) {
              post = r[4] == null ? '' : r[4];
              $.extend(info, {
                type:  'plain',
                regex: new RegExp('([ \\t]*//)?[ \\t]*' + r[2].regEsc() + '(\\S*)' + post.regEsc(), 'm'),
                repl:  new RegExp('(([ \\t]*//)?[ \\t]*' + r[2].regEsc() + ')\\S*(' + post.regEsc() + ')', 'm')
              });
              if (r[3].match(/false|true/)) {
                info.type = 'toggle';
                info.options = ['false','true'];
              }
            }
          }
        }
      }

      // Success?
      if (info.type) {
        $.extend(info, {
          line:   r[0],
          pre:    r[1] == null ? '' : r[1].replace('//',''),
          define: r[2],
          post:   post
        });
        // Get the end-of-line comment, if there is one
        var tooltip = '', eoltip = '';
        find = new RegExp('.*#define[ \\t].*/[/*]+[ \\t]*(.*)');
        if (info.line.search(find) >= 0)
          eoltip = tooltip = info.line.replace(find, '$1');

        // Get all the comments immediately before the item, also include #define lines preceding it
        var s;
        // find = new RegExp('(([ \\t]*(//|#)[^\n]+\n+){1,4})' + info.line.regEsc(), 'g');
        find = new RegExp('(([ \\t]*//+[^\n]+\n+)+([ \\t]*(//)?#define[^\n]+\n+)*)' + info.line.regEsc(), 'g');
        if (r = find.exec(txt)) {
          var temp = [], tips = [];

          // Find each line in forward order, store in reverse
          find = new RegExp('^[ \\t]*//+[ \\t]*(.*)[ \\t]*$', 'gm');
          while((s = find.exec(r[1])) !== null) temp.unshift(s[1]);

          this.log(name+":\n"+temp.join('\n'), LOG_PARSE);

          // Go through the reversed lines and add comment lines on
          $.each(temp, function(i,v) {
            // @ annotation breaks the comment chain
            if (v.match(/^[ \\t]*\/\/+[ \\t]*@/)) return false;
            // A #define breaks the chain, after a good tip
            if (v.match(/^[ \\t]*(\/\/+)?[ \\t]*#define/)) return (tips.length < 1);
            // Skip unwanted lines
            if (v.match(/^[ \\t]*(={5,}|#define[ \\t]+.*)/g)) return true;
            tips.unshift(v);
          });

          // Build the final tooltip, extract embedded options
          $.each(tips, function(i,tip) {
            // if (tip.match(/^#define[ \\t]/) != null) tooltip = eoltip;
            // JSON data? Save as select options
            var parts = tip.match(/:([\[{].+)/);
            if (parts != null && info.options === undefined) {
              // TODO
              // :[1-6] = value limits
              self.log(name + '[]=' + parts[1], LOG_OPTIONS);
              var o = eval('o=' + parts[1]), isArr = isArray(o);
              info.options = o;
              if (isArr && o.length == 2 && !eval(''+o[0]))
                info.type = 'toggle';
            }
            else {
              // Other lines added to the tooltip
              tooltip += ' ' + tip + '\n';
            }
          });

        } // found comments

        // Add .tooltip and .lineNum properties to the info
        find = new RegExp('^'+name); // Strip the name from the tooltip
        var lineNum = this.getLineNumberOfText(info.line, txt);

        // See if this define is enabled conditionally
        var enable_cond = '';
        $.each(dependent_groups, function(cond,dat){
          $.each(dat, function(i,o){
            if (o.cindex == cindex && lineNum > o.start && lineNum < o.end) {
              if (enable_cond != '') enable_cond += ' && ';
              enable_cond += '(' + cond + ')';
            }
          });
        });

        $.extend(info, {
          tooltip: '<strong>'+name+'</strong> '+tooltip.trim().replace(find,'').toHTML(),
          lineNum: lineNum,
          switchable: (info.type != 'switch' && info.line.match(/^[ \t]*\/\//)) || false, // Disabled? Mark as "switchable"
          enabled: enable_cond.length ? enable_cond : 'true'
        });

      } // if info.type
      else
        info = null;

      this.log(info, LOG_PARSE);

      this.log('<< getDefineInfo:'+name, LOG_FUNC);

      return info;
    },

    /**
     * Count the number of lines before a match, return -1 on fail
     */
    getLineNumberOfText: function(line, txt) {
      var pos = txt.indexOf(line);
      return (pos < 0) ? pos : txt.lineCount(pos);
    },

    /**
     * Add a temporary message to the page
     */
    setMessage: function(msg,type) {
      if (msg) {
        if (type === undefined) type = 'message';
        var $err = $('<p class="'+type+'">'+msg+'<span>x</span></p>').appendTo($msgbox), err = $err[0];
        var baseColor = $err.css('color').replace(/rgba?\(([^),]+,[^),]+,[^),]+).*/, 'rgba($1,');
        err.pulse_offset = (pulse_offset += 200);
        err.startTime = Date.now() + pulse_offset;
        err.pulser = setInterval(function(){
            var pulse_time = Date.now() + err.pulse_offset;
            var opac = 0.5+Math.sin(pulse_time/200)*0.4;
            $err.css({color:baseColor+(opac)+')'});
            if (pulse_time - err.startTime > 2500 && opac > 0.899) {
              clearInterval(err.pulser);
            }
          }, 50);
        $err.click(function(e) {
          $(this).remove();
          self.adjustFormLayout();
          return false;
        }).css({cursor:'pointer'});
      }
      else {
        $msgbox.find('p.error, p.warning').each(function() {
          if (this.pulser !== undefined && this.pulser)
            clearInterval(this.pulser);
          $(this).remove();
        });
      }
      self.adjustFormLayout();
    },

    adjustFormLayout: function() {
      var wtop = $(window).scrollTop(),
          ctop = $cfg.offset().top,
          thresh = $form.offset().top+100;
      if (ctop < thresh) {
        var maxhi = $form.height(); // pad plus heights of config boxes can't be more than this
        var pad = wtop > ctop ? wtop-ctop : 0; // pad the top box to stay in view
        var innerpad = Math.ceil($cfg.height() - $cfg.find('pre').height());
        // height to use for the inner boxes
        var hi = ($(window).height() - ($cfg.offset().top - pad) + wtop - innerpad)/2;
        if (hi < 200) hi = 200;
        $cfg.css({ paddingTop: pad });
        var $pre = $('pre.config');
        $pre.css({ height: Math.floor(hi) - $pre.position().top });
      }
      else {
        $cfg.css({ paddingTop: wtop > ctop ? wtop-ctop : 0, height: '' });
      }
    },

    setRequestError: function(stat, path) {
      self.setMessage('Error '+stat+' – ' + path.replace(/^(https:\/\/[^\/]+\/)?.+(\/[^\/]+)$/, '$1...$2'), 'error');
    },

    getErrorObject : function() {
      try { throw Error('') } catch(err) { return err; }
    },

    log_prefix: '',

    log: function(o,l) {
      if (l === undefined) l = 0;
      if (this.logging & l) {
        var line = this.getErrorObject().stack.split("\n")[3].replace(/.+\.js:(\d+):.+/, '$1'),
            type = "ECHO";
        switch (l) {
          case LOG_ECHO:    type = 'ECHO';    break;
          case LOG_WARNING: type = 'WARNING'; break;
          case LOG_ERROR:   type = 'ERROR';   break;
          case LOG_FUNC:    type = 'FUNC';    break;
          case LOG_PARSE:   type = 'PARSE';   break;
          case LOG_MORE:    type = 'MORE';    break;
        }
        var fun = (l == LOG_FUNC);
        if (fun && o.match(/^<</)) self.log_prefix = self.log_prefix.substring(2);
        console.log(line + ':' + type + ': ' + self.log_prefix, o);
        if (fun && o.match(/^>>/)) self.log_prefix += '--';
      }
    },

    logOnce: function(o, l) {
      if (o.didLogThisObject === undefined) {
        this.log(o, l);
        o.didLogThisObject = true;
      }
    },

    EOF: null
  };

})();

// Typically the app would be in its own file, but this would be here
window.configuratorApp.init();

});
