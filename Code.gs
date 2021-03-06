/**
 *  Simple Event Logger - Google Script Code v 1.3
 *
 *  Author: 
 *    Kevin LaFramboise (krlaframboise)
 *
 *  URL to documentation:
 *    https://github.com/krlaframboise/SmartThings/tree/master/smartapps/krlaframboise/simple-event-logger.src#simple-event-logger
 *
 *  Changelog:
 *
 *    1.3 (02/26/2017)
 *      -  Fixed archive issue when invalid or missing date in first column.
 *      -  Added option for logging short date and hour columns.
 *
 *    1.2.1 (01/28/2017)
 *      - Fixed issue with archive process when rows are frozen.
 *
 *    1.2 (01/22/2017)
 *      - Added archive functional for out of space and event limit.
 *      - Changed Maximum rows to 500000 because the sheet becomes very slow once you reach that size.
 *
 *    1.1 (01/02/2017)
 *      - Fixed Log Size calculation and added option to delete extra columns which will drastically increase the amount of clolumns that can be stored.
 *
 *    1.0.0 (12/26/2016)
 *      - Initial Release
 *
 *  Licensed under the Apache License, Version 2.0 (the
 *  "License"); you may not use this file except in
 *  compliance with the License. You may obtain a copy of
 *  the License at:
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in
 *  writing, software distributed under the License is
 *  distributed on an "AS IS" BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing
 *  permissions and limitations under the License.
 *
 */
   
var getVersion = function() { return "01.03.00"; }
 
var sensorStates = {};
sensorStates["closed"] = "inactive";
sensorStates["open"] = "active";
sensorStates["present"] = "active";
sensorStates["not present"] = "inactive";
sensorStates["active"] = "active";
sensorStates["inactive"] = "inactive";
sensorStates["online"] = "active";
sensorStates["offline"] = "inactive";
sensorStates["on"] = "active";
sensorStates["off"] = "inactive";

function doGet(e) {
	var output = "Version " + getVersion()
	return ContentService.createTextOutput(output);
}

function doPost(e) {
	var result = new Object();
	result.version = getVersion();
	result.eventsLogged = 0;
	
	if (e && e.contentLength > 0) {		
		var data = JSON.parse(e.postData.contents);
		if (data) {	
			var sheet = SpreadsheetApp.getActiveSheet();
			
			if (needToArchive(sheet, data.archiveOptions, data.events.length)) {
				result = archiveSheet(sheet, result);
			}
			else {
				result = logEvents(sheet, data, result);
			}
			
			result.freeSpace = calculateAvailableLogSpace(sheet);
			sendPostback(data.postBackUrl, result);
		}
	}
	
	return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);	
}

var logEvents = function(sheet, data, result) {
	try {
		result.totalEventsLogged = sheet.getLastRow() - 1;

		initializeHeaderRow(sheet, data.logDesc, data.logReporting)
		
		for each (event in data.events) {
			logEvent(sheet, data.logDesc, data.logReporting, event);
			result.eventsLogged++;
		}
		
		if (data.deleteExtraColumns) {
			deleteExtraColumns(sheet);
		}
				
		result.totalEventsLogged = sheet.getLastRow() - 1;
		result.success = true;
	}
	catch(e) {
		if (e.message.contains("above the limit")) {
			result.logIsFull = true
		}
		result.error = e.message;
		result.success = false;
	}
	return result;
}

var logEvent = function(sheet, logDesc, logReporting, event) {
	var newRow = [
		event.time,
		event.device,
		event.name,
		event.value
	];
	if (logDesc || logReporting) {
		newRow.push(event.desc);
	}
	if (logReporting) {
		var dateCell = "A" + (sheet.getLastRow() + 1).toString()
		newRow.push("=INT(" + dateCell + ")");
		newRow.push("=HOUR(" + dateCell + ")");
	}	
	sheet.appendRow(newRow);
    var targetSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LatestStatus");
    setSensorState(targetSheet, event.device, event.name, event.value, event.time, false)
}

var initializeHeaderRow = function(sheet, logDesc, logReporting) {		
	if (sheet.getLastRow() == 0) {
		var header = [
			"Date/Time",
			"Device",
			"Event Name",
			"Event Value",
            "=arrayformula( if( row(F:F)=1, \"EventDate\", DATEVALUE (YEAR(A:A)&\"/\"&MONTH(A:A)&\"/\"&DAY(A:A))))",
            "=arrayformula( if( row(G:G)=1, \"DeviceID\", SUBSTITUTE(B:B, \"Motion Sensor\", \"MS\" )))",
            "=arrayformula( if( row(H:H)=1, \"EventHour\",HOUR(A:A)))"
		];		
		sheet.appendRow(header);
		sheet.getRange("A:A").setNumberFormat('MM/dd/yyyy HH:mm:ss');
	}	
	if (logDesc || logReporting) {
		sheet.getRange("E1").setValue("Description")
	}
	if (logReporting && sheet.getRange("F1").getValue() != "Date") {
		sheet.getRange("F1").setValue("Date")
		sheet.getRange("F:F").setNumberFormat('MM/dd/yyyy');
		sheet.getRange("G1").setValue("Hour")
		sheet.getRange("G:G").setNumberFormat('00');
	}
}

var deleteExtraColumns = function(sheet) {
	try {
		sheet.deleteColumns((sheet.getLastColumn() + 1), (sheet.getMaxColumns() - sheet.getLastColumn()))
	}
	catch (e) {
	
	}
}

var calculateAvailableLogSpace = function(sheet) {
	var cellsUsed = (sheet.getMaxRows() * sheet.getMaxColumns());
	var spaceUsed = (cellsUsed / getLogCapacity()) * 100;
	return (100 - spaceUsed).toFixed(2) + "%";
}

var sendPostback = function(url, result) {
	var options = {
			'method': 'post',
			'headers': {"Content-Type": "application/json"},
			'payload': JSON.stringify(result)
	};
		
	var response = UrlFetchApp.fetch(url, options);	
}

var getLogCapacity = function() { return 500000; }

var needToArchive = function(sheet, archiveOptions, newEvents) {
	switch (archiveOptions.type) {
		case "Out of Space":
			return (archiveOptions.logIsFull || ((sheet.getMaxRows() + newEvents) >= (getLogCapacity() / sheet.getMaxColumns())));
		case "Events":
			return (archiveOptions.logIsFull || ((sheet.getLastRow() + newEvents) >= archiveOptions.interval));
		// case "Days":
			// return (getDaysSince(sheet.getRange(2, 1).value) >= archiveOptions.interval);
		default:
			return false;
	}
}

// var getDaysSince = function(firstDT) {
	// var dayMS = 1000 * 60 * 60 * 24;
	// var currentDT = new Date();
	// var currentDate = Date.UTC(currentDT.getFullYear(), currentDT.getMonth(), currentDT.getDate());
	// var firstDate = Date.UTC(firstDT.getFullYear(), firstDT.getMonth(), firstDT.getDate());
	// var diffMS = Math.abs(currentDate - firstDate);
	// return Math.floor(diffMS / dayMS); 	
// }

var archiveSheet = function(sheet, result) {	
	try {
		var archiveSheet = createArchiveSheet(sheet);
		if (archiveSheet) {
			if (verifyArchiveSheet(sheet, archiveSheet)) {
				clearSheet(sheet);
				result.eventsArchived = true;
				result.success = true;
			}
			else {
				result.success = false;
				result.error = "The number of rows and columsn in thea archive Sheet do not match the original sheet so the original file was not cleared.";				
			}
		}
		else {
			result.success = false;
			result.error = "Unable to create archive file.";			
		}
		result.totalEventsLogged = sheet.getLastRow() - 1;		
	}
	catch(e) {
		result.error = e.message;
		result.success = false;
	}
	return result;
}

var createArchiveSheet = function(sheet) {
	var archiveSheetName = getArchiveSheetName(SpreadsheetApp.getActive().getName(), sheet);
	var archiveFile = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).makeCopy(archiveSheetName);
	return SpreadsheetApp.open(archiveFile);
}


var getArchiveSheetName = function(name, sheet) {
	var firstDate = sheet.getRange("A2").getValue();
	var lastDate = sheet.getRange(sheet.getLastRow(), 1).getValue();
	return name + "_" + getFormattedDate(firstDate) + "_" + getFormattedDate(lastDate);
}

var getFormattedDate = function(dt) {
	try {
		var yyyy = dt.getFullYear().toString(); 
		var mm = (dt.getMonth()+1).toString(); 
		var dd = dt.getDate().toString(); 
		return yyyy + "-" + (mm[1] ? mm : ("0" + mm[0])) + "-" + (dd[1] ? dd : ("0" + dd[0])); 
	}
	catch (ex) {
		return "undetermined"
	}
}

var verifyArchiveSheet = function(sheet, archiveSheet) {
	return (sheet.getLastRow() == archiveSheet.getLastRow() && sheet.getLastColumn() == archiveSheet.getLastColumn());
}

var clearSheet = function(sheet) {
	if (sheet.getMaxRows() > 2) {
		sheet.deleteRows(3, (sheet.getMaxRows() - 2));
	}
	sheet.getRange(2, 1, 1, sheet.getLastColumn()).clearContent();
}  

var setSensorState = function (targetSheet, deviceID, eventName, eventValue, dateTime, firstTime) {
  var values = targetSheet.getRange('A:A').getValues();
  var updateRow = 0;
  for (i = 0; i < values.length; i++){
    // If this is first time and we have already sensor, then break
    if ((values[i][0] == deviceID) && firstTime) {
      return true;
    } else if ((values[i][0] == deviceID) || (values[i][0].length == 0)) {
      updateRow = i + 1
      break;
    }
  }
  // Either update an existing row or create a new one.
  targetSheet.getRange(updateRow, 1).setValue(deviceID);
  targetSheet.getRange(updateRow, 2).setValue(eventName);
  targetSheet.getRange(updateRow, 3).setValue((sensorStates[eventValue] == null ? eventValue : sensorStates[eventValue]));
  targetSheet.getRange(updateRow, 4).setValue(dateTime);
  
  return true;

}

function testSensorState (deviceID, eventName, eventValue, dateTime) {
  setSensorState("Door - Front", "contact", sensorStates["open"], "12/19/2017 10:20:58")
  setSensorState("Motion Sensor - Hallway", "motion", sensorStates["inactive"], "12/19/2017 10:20:58")
  setSensorState("Door - Front", "contact", sensorStates["closed"], "12/19/2017 10:20:58")
}

/***
 * This seems to operate incredibly slowly, like one row each second
 * Method works from the last entry up and records the last state of each sensor
 * This is to seed the LatestStatus table which tracks the latest status for each sensor
 */
function setAllLatestStates() {
  var targetSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("LatestStatus");
  var sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange("D:D").setNumberFormat('MM/dd/yyyy HH:mm:ss');
  var values = sheet.getRange('A:D').getValues();
  var listlength = values.length;
  for (var i = listlength - 1; i > 0 ; i--) {
    setSensorState(targetSheet, values[i][1], values[i][2], values[i][3], values[i][0], true)
  }
}